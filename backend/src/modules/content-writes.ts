import { Router } from "express";
import { parsePatch } from "../lib/patch.js";
import { catalogFilter } from "./catalog.js";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { config } from "../config.js";
import { HttpError, identifier, ok } from "../lib/http.js";
import { safeFilename, savePdf, storage } from "../storage/index.js";
import { contentModels, FileAsset, SubjectOffering } from "./models.js";
import { audit, AuthRequest } from "./auth.js";
import { slugify } from "../import/inventory.js";
import { enqueueJob, enqueueWatermark } from "../processing/jobs.js";
import { findDuplicates } from "../processing/fingerprint.js";
import {
  DUPLICATE_THRESHOLD,
  FINGERPRINT_VERSION,
  MAX_HASHED_PAGES,
  PAGE_HASH_HEX,
  SKETCH_SIZE,
  markdownFingerprint,
  type Fingerprint,
} from "../lib/fingerprint.js";
// The free API has 0.1 CPU: requests only validate and store; covers render in the queue.
const light = { thumbnail: false };
async function afterUpload(kind: string, id: unknown, user: unknown) {
  await enqueueWatermark(kind as any, id, { requestedBy: user, hold: true });
  await enqueueJob("thumbnail", kind as any, id, { requestedBy: user });
  // The browser's fingerprint is kept meanwhile; this recomputes it from the stored file.
  await enqueueJob("fingerprint", kind as any, id, { requestedBy: user });
}
type Kind = "papers" | "notes";
// What the uploader's browser computed from the PDF (see lib/fingerprint.ts).
const sketchInput = z
  .object({
    chars: z.number().int().min(0),
    shingles: z.number().int().min(0),
    sketch: z.array(z.number().int().min(0)).max(SKETCH_SIZE),
  })
  .strict()
  .nullable();
const fingerprintInput = z
  .object({
    v: z.literal(FINGERPRINT_VERSION),
    pages: z
      .array(
        z
          .string()
          .regex(/^[0-9a-f]*$/)
          .max(PAGE_HASH_HEX),
      )
      .max(MAX_HASHED_PAGES),
    text: sketchInput,
    ocr: sketchInput.optional(),
  })
  .strict();
const parseFingerprint = (raw: unknown): Fingerprint => {
  const parsed = fingerprintInput.parse(raw);
  return {
    v: parsed.v,
    pages: parsed.pages,
    text: parsed.text ?? null,
    ocr: parsed.ocr ?? null,
  };
};
const duplicateCheckInput = z
  .object({
    kind: z.enum(["papers", "notes"]),
    fingerprint: fingerprintInput,
    exclude: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .optional(),
  })
  .strict();
/**
 * Refuses an upload whose content is already in the library. An admin can pass
 * `allowDuplicate` to keep a copy on purpose (a better scan of the same paper, say).
 */
async function guardDuplicates(
  kind: Kind,
  fingerprint: Fingerprint,
  {
    admin,
    allowDuplicate,
    exclude,
  }: { admin: boolean; allowDuplicate?: unknown; exclude?: unknown },
) {
  const matches = await findDuplicates(kind, fingerprint, { exclude });
  const top = matches[0];
  if (!top || top.score < DUPLICATE_THRESHOLD) return matches;
  if (admin && allowDuplicate === true) return matches;
  throw new HttpError(
    409,
    `This ${kind === "notes" ? "note" : "paper"} is already in the library: ${top.similarity}% of its content matches “${top.item.title}”. Only one copy of each is kept.`,
    "DUPLICATE_CONTENT",
    { matches },
  );
}
const stamp = (fingerprint: Fingerprint, by: "browser" | "server") => ({
  ...fingerprint,
  by,
  computedAt: new Date(),
});
import { withSharedOfferings } from "./standard-subjects.js";
import { PAYMENT_QR_REQUIRED } from "./profile.js";
import { notifyCorrection, notifyUploads } from "./notifications.js";
// Contributors are paid by UPI QR, so one must be on file before anything is uploaded.
function requirePaymentQr(user: any) {
  if (user.role !== "admin" && !user.profile?.paymentQrKey)
    throw PAYMENT_QR_REQUIRED;
}
// The same PDF may sit in any version slot; it must not be uploaded twice.
const usesAsset = (id: unknown) => ({
  $or: [{ asset: id }, { "files.original": id }, { "files.processed": id }],
  deletedAt: null,
});
const id = z.string().regex(/^[a-f0-9]{24}$/i);
const shared = {
  title: z.string().trim().min(3).max(240),
  offerings: z.array(id).max(20).default([]),
  credit: z.string().max(160).optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
};
const paperInput = z
  .object({
    ...shared,
    year: z.coerce.number().int().min(1900).max(2200).optional(),
    session: z.string().max(80).optional(),
    examType: z
      .enum(["Mid-Sem", "End-Sem", "Supplementary", "Other", "Unknown"])
      .default("Unknown"),
    scheme: z.string().max(80).optional(),
  })
  .strict();
const noteInput = z
  .object({
    ...shared,
    format: z.enum(["pdf", "markdown"]).default("pdf"),
    markdown: z.string().max(100_000).optional(),
    unit: z.string().max(80).optional(),
    topic: z.string().max(160).optional(),
  })
  .strict();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 5,
    fields: 3,
    fieldSize: 256_000,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf")
      cb(new HttpError(400, "Only PDF files are accepted"));
    else cb(null, true);
  },
});
// What the browser processing step reports; kept small and descriptive only.
const processedMetaInput = z
  .object({
    pages: z.number().int().min(1).max(400),
    sourcePages: z.number().int().min(1).max(400),
    split: z.array(z.number().int().min(1)).max(400).default([]),
    enhanced: z.array(z.number().int().min(1)).max(400).default([]),
    // Pages where a handwritten roll number was painted over.
    redacted: z.array(z.number().int().min(1)).max(400).default([]),
    preset: z.enum(["grayscale", "bw", "color"]),
    mode: z.enum(["needed", "all", "none"]),
  })
  .strict();
const versionChoice = z.enum(["original", "processed"]);
const pdfFields = [
  { name: "file", maxCount: 1 },
  { name: "processed", maxCount: 1 },
];
const uploadLimit = rateLimit({
  windowMs: 3600_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
function metadata(req: any) {
  if (req.is("multipart/form-data")) {
    try {
      return JSON.parse(req.body.metadata || "{}");
    } catch {
      throw new HttpError(400, "Invalid metadata JSON");
    }
  }
  return req.body;
}
export async function validateOfferings(ids: string[]) {
  if (
    new Set(ids).size !== ids.length ||
    (await SubjectOffering.countDocuments({ _id: { $in: ids } })) !== ids.length
  )
    throw new HttpError(400, "Select existing subject offerings.");
}
export function publishable(item: any) {
  if (
    !item.offerings?.length ||
    (!item.asset && !(item.format === "markdown" && item.markdown?.trim()))
  )
    throw new HttpError(
      400,
      "Publication requires a subject offering and a PDF or Markdown content.",
    );
}
export function contentWriteRouter(admin: boolean) {
  const router = Router();
  router.get("/uploads", async (req: AuthRequest, res) => {
    const [papers, notes] = await Promise.all(
      Object.values(contentModels).map((m) =>
        m
          .find({ author: req.user._id })
          .select("-fingerprint")
          .sort({ createdAt: -1 })
          .limit(200)
          .lean(),
      ),
    );
    ok(res, { papers, notes });
  });
  // The upload page asks before sending a file whether its content is already here.
  router.post("/duplicates/check", async (req: AuthRequest, res) => {
    const { kind, fingerprint, exclude } = duplicateCheckInput.parse(req.body);
    const matches = await findDuplicates(
      kind,
      {
        ...fingerprint,
        text: fingerprint.text ?? null,
        ocr: fingerprint.ocr ?? null,
      },
      { exclude },
    );
    ok(res, { matches, threshold: DUPLICATE_THRESHOLD });
  });
  for (const [kind, model] of Object.entries(contentModels)) {
    const schema = kind === "papers" ? paperInput : noteInput;
    router.get(`/${kind}`, async (req: AuthRequest, res) => {
      const query: any = admin ? {} : { author: req.user._id };
      if (req.query.status)
        query.status = z
          .enum(["draft", "pending", "published", "rejected"])
          .parse(req.query.status);
      if (req.query.deleted !== "true") query.deletedAt = null;
      if (req.query.q)
        Object.assign(
          query,
          (await catalogFilter({ q: req.query.q }, false)).filter,
        );
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(1)
        .parse(req.query.page);
      const [data, total] = await Promise.all([
        model
          .find(query)
          .select("-fingerprint")
          .populate("author", "name email")
          .populate({
            path: "offerings",
            populate: ["subject", "branch", "semester"],
          })
          .sort({ createdAt: -1 })
          .skip((page - 1) * 30)
          .limit(30)
          .lean(),
        model.countDocuments(query),
      ]);
      ok(res, data, { total, page, pages: Math.ceil(total / 30) });
    });
    // Owner/admin access for browser-side processing and comparison.
    router.get(
      `/${kind}/:id/source/:version`,
      async (req: AuthRequest, res, next) => {
        const version = versionChoice.parse(req.params.version);
        const item: any = await model
          .findOne({
            _id: identifier(req.params.id),
            ...(admin ? {} : { author: req.user._id }),
          })
          .select("asset files")
          .lean();
        const assetId =
          item?.files?.[version] ??
          (version === "original" ? item?.asset : null);
        const asset: any =
          assetId && (await FileAsset.findById(assetId).lean());
        if (!asset || asset.deletedAt)
          throw new HttpError(404, "This version is not available.");
        const object = await storage.get(asset.key);
        res.set({
          "Content-Type": "application/pdf",
          "Content-Length": String(object.size),
          "Cache-Control": "private, no-store",
          "Content-Disposition": `inline; filename="${safeFilename(asset.originalName || "paper.pdf")}"`,
        });
        object.body.on("error", next);
        res.on("close", () => object.body.destroy());
        object.body.pipe(res);
      },
    );
    const editable = (req: AuthRequest) => ({
      _id: identifier(req.params.id),
      deletedAt: null,
      ...(admin
        ? {}
        : {
            author: req.user._id,
            status: { $in: ["draft", "pending", "rejected"] },
          }),
    });
    // A contributor change goes back to review; a published item keeps serving
    // its current watermarked copy until the new one is ready.
    async function switchTo(req: AuthRequest, item: any, version: string) {
      item.activeVersion = version;
      if (!admin) {
        item.status = "pending";
        item.rejectionReason = undefined;
        item.correction = undefined;
      }
      await item.save();
      await enqueueWatermark(kind as any, item._id, {
        requestedBy: req.user._id,
        hold: item.status !== "published",
      });
      await enqueueJob("thumbnail", kind as any, item._id, {
        requestedBy: req.user._id,
      });
    }
    router.post(
      `/${kind}/:id/processed`,
      uploadLimit,
      upload.single("processed"),
      async (req: AuthRequest, res) => {
        const item: any = await model.findOne(editable(req));
        if (!item?.asset) throw new HttpError(404, "Editable upload not found");
        if (!req.file) throw new HttpError(400, "Upload the processed PDF.");
        const raw = metadata(req);
        const meta = processedMetaInput.parse(raw.processedMeta);
        const activate = z.boolean().default(true).parse(raw.activate);
        const asset = await savePdf(req.file, light);
        if (!item.files) item.files = { original: item.asset };
        if (!item.files.original) item.files.original = item.asset;
        item.files.processed = asset._id;
        item.files.processedMeta = meta;
        if (item.files.watermarked) {
          item.files.watermarked.processed = undefined;
          item.files.watermarked.processedSignature = undefined;
        }
        await switchTo(
          req,
          item,
          activate ? "processed" : item.activeVersion || "original",
        );
        await audit(req, "process-apply", `${kind}/${item._id}`, {
          pages: meta.pages,
          split: meta.split.length,
          enhanced: meta.enhanced.length,
          activate,
        });
        ok(res, { activeVersion: item.activeVersion });
      },
    );
    router.post(`/${kind}/:id/activate`, async (req: AuthRequest, res) => {
      const { version } = z
        .object({ version: versionChoice })
        .strict()
        .parse(req.body);
      const item: any = await model.findOne(editable(req));
      if (!item?.asset) throw new HttpError(404, "Editable upload not found");
      if (!item.files) item.files = { original: item.asset };
      if (!item.files[version])
        throw new HttpError(400, "That version does not exist yet.");
      await switchTo(req, item, version);
      await audit(
        req,
        version === "original" ? "process-revert" : "process-activate",
        `${kind}/${item._id}`,
      );
      ok(res, { activeVersion: item.activeVersion });
    });
    router.get(`/${kind}/:id/processing`, async (req: AuthRequest, res) => {
      const item: any = await model
        .findOne({
          _id: identifier(req.params.id),
          ...(admin ? {} : { author: req.user._id }),
        })
        .select("activeVersion watermark files.processed files.processedMeta")
        .lean();
      if (!item) throw new HttpError(404, "Upload not found");
      ok(res, {
        activeVersion: item.activeVersion || "original",
        hasProcessed: Boolean(item.files?.processed),
        processedMeta: item.files?.processedMeta || null,
        watermark: item.watermark || { status: "none" },
      });
    });
    router.get(`/${kind}/:id`, async (req: AuthRequest, res) => {
      const item = await model
        .findOne({
          _id: identifier(req.params.id),
          ...(admin ? {} : { author: req.user._id }),
        })
        .populate("asset")
        .lean();
      if (!item) throw new HttpError(404, "Upload not found");
      ok(res, item);
    });
    router.post(
      `/${kind}`,
      uploadLimit,
      upload.fields(pdfFields),
      async (req: AuthRequest, res) => {
        const parts = (req.files || {}) as Record<
          string,
          Express.Multer.File[]
        >;
        requirePaymentQr(req.user);
        req.file = parts.file?.[0];
        const processedFile = parts.processed?.[0];
        const {
            useVersion: rawVersion,
            processedMeta: rawMeta,
            fingerprint: rawFingerprint,
            allowDuplicate,
            ...raw
          } = metadata(req),
          status = admin
            ? z
                .enum(["draft", "pending", "published"])
                .default("pending")
                .parse(raw.status)
            : req.user.trusted
              ? "published"
              : "pending";
        const { status: _discarded, ...fields } = raw;
        const input: any = schema.parse(fields);
        await validateOfferings(input.offerings);
        input.offerings = await withSharedOfferings(input.offerings);
        if (
          kind === "notes" &&
          input.format === "markdown" &&
          !input.markdown?.trim()
        )
          throw new HttpError(400, "Markdown content is required.");
        if ((kind === "papers" || input.format === "pdf") && !req.file)
          throw new HttpError(400, "A PDF is required.");
        // Checked before the file is stored, so a refused copy leaves nothing behind.
        const fingerprint: Fingerprint | null = rawFingerprint
          ? parseFingerprint(rawFingerprint)
          : kind === "notes" && input.format === "markdown"
            ? markdownFingerprint(input.markdown)
            : null;
        if (fingerprint)
          await guardDuplicates(kind as Kind, fingerprint, {
            admin,
            allowDuplicate,
          });
        const asset = req.file ? await savePdf(req.file, light) : null;
        if (asset && (await model.exists(usesAsset(asset._id))))
          throw new HttpError(409, "This PDF is already in the library.");
        const processedMeta =
          asset && processedFile
            ? processedMetaInput.parse(rawMeta)
            : undefined;
        const processed = processedMeta
          ? await savePdf(processedFile!, light)
          : null;
        const active =
          processed &&
          versionChoice.default("original").parse(rawVersion) === "processed"
            ? "processed"
            : "original";
        const data = {
          ...input,
          asset: active === "processed" ? processed!._id : asset?._id,
          ...(asset
            ? {
                files: {
                  original: asset._id,
                  ...(processed
                    ? { processed: processed._id, processedMeta }
                    : {}),
                },
                activeVersion: active,
                watermark: { status: "queued", hold: true },
              }
            : {}),
          author: req.user._id,
          status,
          slug: `${slugify(input.title)}-${randomUUID().slice(0, 8)}`,
          publishedAt: status === "published" ? new Date() : null,
          ...(fingerprint
            ? {
                fingerprint: stamp(
                  fingerprint,
                  rawFingerprint ? "browser" : "server",
                ),
              }
            : {}),
        };
        if (status === "published") publishable(data);
        const item = await model.create(data);
        if (asset) await afterUpload(kind, item._id, req.user._id);
        await audit(req, "upload", `${kind}/${item._id}`, {
          duplicateOverride: Boolean(admin && allowDuplicate === true),
        });
        void notifyUploads(req.user, kind as any, [item]);
        res.status(201);
        ok(res, item);
      },
    );
    router.post(
      `/${kind}/bulk`,
      uploadLimit,
      upload.array("files", 5),
      async (req: AuthRequest, res) => {
        let rows: any[];
        try {
          rows = z
            .array(z.any())
            .min(1)
            .max(5)
            .parse(JSON.parse(req.body.metadata));
        } catch {
          throw new HttpError(400, "Provide one metadata row for each PDF.");
        }
        const files = req.files as Express.Multer.File[];
        if (!files?.length || files.length !== rows.length)
          throw new HttpError(400, "Metadata rows must match the files.");
        requirePaymentQr(req.user);
        const results = [];
        // Per-file results make partial success explicit and safe to retry selectively.
        for (let i = 0; i < files.length; i++) {
          try {
            const {
                status: _ignored,
                fingerprint: rawFingerprint,
                allowDuplicate,
                ...row
              } = rows[i],
              input: any = schema.parse(row);
            await validateOfferings(input.offerings);
            input.offerings = await withSharedOfferings(input.offerings);
            const fingerprint: Fingerprint | null = rawFingerprint
              ? parseFingerprint(rawFingerprint)
              : null;
            if (fingerprint)
              await guardDuplicates(kind as Kind, fingerprint, {
                admin,
                allowDuplicate,
              });
            const asset = await savePdf(files[i], light);
            if (await model.exists(usesAsset(asset._id)))
              throw new HttpError(409, "Duplicate PDF");
            const state = admin
              ? z
                  .enum(["draft", "pending", "published"])
                  .default("pending")
                  .parse(rows[i].status)
              : req.user.trusted
                ? "published"
                : "pending";
            const data = {
              ...input,
              asset: asset._id,
              files: { original: asset._id },
              watermark: { status: "queued", hold: true },
              author: req.user._id,
              status: state,
              slug: `${slugify(input.title)}-${randomUUID().slice(0, 8)}`,
              publishedAt: state === "published" ? new Date() : null,
              ...(fingerprint
                ? { fingerprint: stamp(fingerprint, "browser") }
                : {}),
            };
            if (state === "published") publishable(data);
            const item = await model.create(data);
            await afterUpload(kind, item._id, req.user._id);
            await audit(req, "bulk-upload", `${kind}/${item._id}`);
            results.push({ index: i, item });
          } catch (e: any) {
            results.push({
              index: i,
              error: e.status ? e.message : "Validation or storage failure",
            });
          }
        }
        void notifyUploads(
          req.user,
          kind as any,
          results.flatMap((r: any) => (r.item ? [r.item] : [])),
        );
        res.status(207);
        ok(res, results);
      },
    );
    router.patch(`/${kind}/:id`, async (req: AuthRequest, res) => {
      const item = await model.findOne({
        _id: identifier(req.params.id),
        ...(admin
          ? {}
          : {
              author: req.user._id,
              status: { $in: ["draft", "pending", "rejected"] },
              deletedAt: null,
            }),
      });
      if (!item) throw new HttpError(404, "Editable upload not found");
      const { status, allowDuplicate, ...fields } = req.body;
      if (!admin && status)
        throw new HttpError(403, "Only an admin can publish");
      const input: any = parsePatch(schema, fields);
      if (input.offerings) {
        await validateOfferings(input.offerings);
        input.offerings = await withSharedOfferings(input.offerings);
      }
      // Rewritten Markdown is content too: it is checked against the other notes.
      if (
        kind === "notes" &&
        typeof input.markdown === "string" &&
        input.markdown !== item.markdown
      ) {
        const fingerprint = markdownFingerprint(input.markdown);
        await guardDuplicates("notes", fingerprint, {
          admin,
          allowDuplicate,
          exclude: item._id,
        });
        if (!item.asset || item.format === "markdown")
          item.fingerprint = stamp(fingerprint, "server");
      }
      Object.assign(item, input);
      if (admin && status)
        item.status = z
          .enum(["draft", "pending", "published", "rejected"])
          .parse(status);
      if (!admin) {
        item.status = "pending";
        item.rejectionReason = undefined;
        item.correction = undefined;
      }
      if (item.status === "published") {
        publishable(item);
        item.publishedAt ||= new Date();
      }
      await item.save();
      await audit(req, "edit", `${kind}/${item._id}`);
      ok(res, item);
    });
    router.post(
      `/${kind}/:id/replace-file`,
      uploadLimit,
      upload.single("file"),
      async (req: AuthRequest, res) => {
        const item = await model.findOne({
          _id: identifier(req.params.id),
          ...(admin
            ? {}
            : { author: req.user._id, status: "pending", deletedAt: null }),
        });
        if (!item) throw new HttpError(404, "Editable upload not found");
        if (!req.file) throw new HttpError(400, "Upload a PDF");
        // A replacement must not turn this upload into a copy of another item.
        const { fingerprint: rawFingerprint, allowDuplicate } = metadata(req);
        const fingerprint: Fingerprint | null = rawFingerprint
          ? parseFingerprint(rawFingerprint)
          : null;
        if (fingerprint)
          await guardDuplicates(kind as Kind, fingerprint, {
            admin,
            allowDuplicate,
            exclude: item._id,
          });
        const asset = await savePdf(req.file, light);
        if (item.asset)
          item.revisions.push({
            asset: item.asset,
            replacedAt: new Date(),
            actor: req.user._id,
          });
        item.asset = asset._id;
        item.files = { original: asset._id };
        item.activeVersion = "original";
        item.watermark = { status: "queued", hold: true };
        item.fingerprint = fingerprint
          ? stamp(fingerprint, "browser")
          : undefined;
        if (kind === "notes") item.format = "pdf";
        await item.save();
        await afterUpload(kind, item._id, req.user._id);
        await audit(req, "replace-file", `${kind}/${item._id}`);
        ok(res, item);
      },
    );
    if (admin)
      for (const action of [
        "approve",
        "reject",
        "restore",
        "feature",
        "unfeature",
        "delete",
      ])
        router.post(`/${kind}/:id/${action}`, async (req: AuthRequest, res) => {
          const item = await model.findById(identifier(req.params.id));
          if (!item) throw new HttpError(404, "Content not found");
          if (action === "approve") {
            publishable(item);
            item.status = "published";
            item.publishedAt ||= new Date();
            item.rejectionReason = undefined;
            item.correction = undefined;
            item.metadataNeedsReview = false;
          }
          if (action === "reject") {
            item.rejectionReason = z
              .string()
              .trim()
              .min(3)
              .max(1000)
              .parse(req.body.reason);
            item.status = "rejected";
          }
          if (action === "delete") item.deletedAt = new Date();
          if (action === "restore") item.deletedAt = null;
          if (action === "feature" || action === "unfeature")
            item.featured = action === "feature";
          await item.save();
          await audit(req, action, `${kind}/${item._id}`);
          ok(res, item);
        });
    // Asks the contributor to fix something, by email and on the upload in their list.
    if (admin)
      router.post(`/${kind}/:id/correction`, async (req: AuthRequest, res) => {
        const message = z
          .string()
          .trim()
          .min(3, "Write what needs to be corrected.")
          .max(2000)
          .parse(req.body?.message);
        const item: any = await model
          .findOne({ _id: identifier(req.params.id), deletedAt: null })
          .populate("author", "name email role");
        if (!item) throw new HttpError(404, "Content not found");
        const author = item.author;
        if (!author?.email || author.role === "admin")
          throw new HttpError(
            409,
            "This upload has no contributor to send a correction to.",
          );
        item.correction = { message, sentAt: new Date(), by: req.user._id };
        await item.save();
        await audit(req, "correction", `${kind}/${item._id}`);
        const emailed = await notifyCorrection(
          author,
          kind as any,
          item,
          message,
        );
        ok(res, { item, emailed });
      });
    if (admin)
      router.delete(`/${kind}/:id`, async (req: AuthRequest, res) => {
        const item = await model.findByIdAndUpdate(
          identifier(req.params.id),
          { $set: { deletedAt: new Date() } },
          { returnDocument: "after" },
        );
        if (!item) throw new HttpError(404, "Content not found");
        await audit(req, "delete", `${kind}/${item._id}`);
        ok(res, item);
      });
  }
  return router;
}
