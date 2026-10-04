import { Router } from "express";
import { parsePatch } from "../lib/patch.js";
import { catalogFilter } from "./catalog.js";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { config } from "../config.js";
import { HttpError, identifier, ok } from "../lib/http.js";
import { savePdf } from "../storage/index.js";
import { contentModels, SubjectOffering } from "./models.js";
import { audit, AuthRequest } from "./auth.js";
import { slugify } from "../import/inventory.js";
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
          .sort({ createdAt: -1 })
          .limit(200)
          .lean(),
      ),
    );
    ok(res, { papers, notes });
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
      upload.single("file"),
      async (req: AuthRequest, res) => {
        const raw = metadata(req),
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
        if (
          kind === "notes" &&
          input.format === "markdown" &&
          !input.markdown?.trim()
        )
          throw new HttpError(400, "Markdown content is required.");
        if ((kind === "papers" || input.format === "pdf") && !req.file)
          throw new HttpError(400, "A PDF is required.");
        const asset = req.file ? await savePdf(req.file) : null;
        if (
          asset &&
          (await model.exists({ asset: asset._id, deletedAt: null }))
        )
          throw new HttpError(409, "This PDF is already in the library.");
        const data = {
          ...input,
          asset: asset?._id,
          author: req.user._id,
          status,
          slug: `${slugify(input.title)}-${randomUUID().slice(0, 8)}`,
          publishedAt: status === "published" ? new Date() : null,
        };
        if (status === "published") publishable(data);
        const item = await model.create(data);
        await audit(req, "upload", `${kind}/${item._id}`);
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
        const results = [];
        // Per-file results make partial success explicit and safe to retry selectively.
        for (let i = 0; i < files.length; i++) {
          try {
            const { status: _ignored, ...row } = rows[i],
              input: any = schema.parse(row);
            await validateOfferings(input.offerings);
            const asset = await savePdf(files[i]);
            if (await model.exists({ asset: asset._id, deletedAt: null }))
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
              author: req.user._id,
              status: state,
              slug: `${slugify(input.title)}-${randomUUID().slice(0, 8)}`,
              publishedAt: state === "published" ? new Date() : null,
            };
            if (state === "published") publishable(data);
            const item = await model.create(data);
            await audit(req, "bulk-upload", `${kind}/${item._id}`);
            results.push({ index: i, item });
          } catch (e: any) {
            results.push({
              index: i,
              error: e.status ? e.message : "Validation or storage failure",
            });
          }
        }
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
      const { status, ...fields } = req.body;
      if (!admin && status)
        throw new HttpError(403, "Only an admin can publish");
      const input: any = parsePatch(schema, fields);
      if (input.offerings) await validateOfferings(input.offerings);
      Object.assign(item, input);
      if (admin && status)
        item.status = z
          .enum(["draft", "pending", "published", "rejected"])
          .parse(status);
      if (!admin) {
        item.status = "pending";
        item.rejectionReason = undefined;
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
        const asset = await savePdf(req.file);
        if (item.asset)
          item.revisions.push({
            asset: item.asset,
            replacedAt: new Date(),
            actor: req.user._id,
          });
        item.asset = asset._id;
        if (kind === "notes") item.format = "pdf";
        await item.save();
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
