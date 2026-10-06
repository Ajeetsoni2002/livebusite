import { Router } from "express";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { config } from "../config.js";
import { storage, safeFilename } from "../storage/index.js";
import { HttpError, identifier, ok } from "../lib/http.js";
import { contentModels } from "./models.js";
import { optionalUser, AuthRequest } from "./auth.js";
export const fileRouter = Router();
const sign = (value: string) =>
  createHmac("sha256", config.accessSecret).update(value).digest("hex");
async function visible(req: AuthRequest) {
  const model = contentModels[String(req.params.kind)];
  if (!model) throw new HttpError(404, "Content not found");
  const item = await model
    .findById(identifier(req.params.id))
    .populate("asset");
  const publicItem = item?.status === "published" && !item.deletedAt;
  const owner =
    req.user &&
    !req.user.mustChangePassword &&
    (req.user.role === "admin" ||
      String(item?.author) === String(req.user._id));
  if (!item || (!publicItem && !owner) || !item.asset || item.asset.deletedAt)
    throw new HttpError(404, "PDF is unavailable.");
  // A new upload is public only once its watermarked copy exists.
  if (!owner && item.watermark?.hold)
    throw new HttpError(
      409,
      "This paper is being prepared. Please try again in a minute.",
      "PREPARING",
    );
  return item;
}
async function accessUrl(req: AuthRequest, attachment: boolean) {
  const item = await visible(req),
    asset = item.asset,
    name = safeFilename(asset.originalName || `${item.slug}.pdf`);
  const url = await storage.readUrl(asset.key, name, attachment);
  if (url) return { item, url };
  const payload = Buffer.from(
    JSON.stringify({
      kind: req.params.kind,
      id: String(item._id),
      exp: Date.now() + 120_000,
      attachment,
    }),
  ).toString("base64url");
  return { item, url: `/api/files/${payload}.${sign(payload)}` };
}
fileRouter.get(
  "/:kind/:id/thumbnail",
  optionalUser,
  async (req: AuthRequest, res, next) => {
    const item = await visible(req);
    if (!item.asset.thumbnailKey)
      throw new HttpError(404, "Thumbnail is unavailable.");
    const object = await storage.get(item.asset.thumbnailKey);
    res.set({
      "Content-Type": "image/webp",
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
    });
    object.body.on("error", next);
    res.on("close", () => object.body.destroy());
    object.body.pipe(res);
  },
);
fileRouter.get(
  "/:kind/:id/preview",
  optionalUser,
  async (req: AuthRequest, res) => {
    const { url } = await accessUrl(req, false);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(url);
  },
);
fileRouter.post(
  "/:kind/:id/download",
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  optionalUser,
  async (req: AuthRequest, res) => {
    const { item, url } = await accessUrl(req, true);
    const eventId = z.uuid().parse(req.get("Idempotency-Key") || randomUUID());
    await import("./analytics.js").then((m) =>
      m.recordDownload(req, item, String(req.params.kind), eventId),
    );
    res.setHeader("Cache-Control", "no-store");
    ok(res, { url });
  },
);
fileRouter.get(
  "/files/:token",
  optionalUser,
  async (req: AuthRequest, res, next) => {
    const [payload, signature] = String(req.params.token).split(".");
    const expected = sign(payload || "");
    if (
      !signature ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new HttpError(403, "File link expired or invalid.");
    let data: any;
    try {
      data = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      throw new HttpError(403, "Invalid file link");
    }
    if (data.exp < Date.now()) throw new HttpError(403, "File link expired.");
    req.params.kind = data.kind;
    req.params.id = data.id;
    const item = await visible(req),
      asset = item.asset,
      total = (await storage.head(asset.key)).size;
    let range: { start: number; end: number };
    if (req.get("Range")) {
      const match = req.get("Range").match(/^bytes=(\d*)-(\d*)$/);
      if (!match || (!match[1] && !match[2]))
        throw new HttpError(416, "Invalid byte range");
      const start = match[1]
        ? Number(match[1])
        : Math.max(0, total - Number(match[2]));
      const end = match[1]
        ? Math.min(match[2] ? Number(match[2]) : total - 1, total - 1)
        : total - 1;
      if (
        start >= total ||
        start > end ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end)
      ) {
        res.set("Content-Range", `bytes */${total}`);
        throw new HttpError(416, "Range outside file");
      }
      range = { start, end };
      res.status(206).set("Content-Range", `bytes ${start}-${end}/${total}`);
    }
    const object = await storage.get(asset.key, range);
    res.removeHeader("X-Frame-Options");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `${data.attachment ? "attachment" : "inline"}; filename="${safeFilename(asset.originalName)}"`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": `default-src 'none'; frame-ancestors 'self' ${config.origins.join(" ")}`,
    });
    object.body.on("error", next);
    res.on("close", () => object.body.destroy());
    object.body.pipe(res);
  },
);
