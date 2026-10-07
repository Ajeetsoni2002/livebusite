import { newPasswordInput } from "../lib/password.js";
import { parsePatch } from "../lib/patch.js";
import { Router } from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { z } from "zod";
import { HttpError, identifier, ok } from "../lib/http.js";
import { audit, AuthRequest } from "./auth.js";
import {
  Paper,
  Note,
  User,
  Session,
  Report,
  PaperRequest,
  AuditLog,
  DailyStats,
  taxonomyModels,
  SubjectOffering,
  contentModels,
} from "./models.js";
import { dayKey } from "./analytics.js";
import { randomUUID } from "node:crypto";
import { Setting, ProcessingJob } from "./models.js";
import { enqueueJob, enqueueWatermark } from "../processing/jobs.js";
import { storage } from "../storage/index.js";
import { FileAsset } from "./models.js";
import {
  defaultWatermark,
  getWatermarkSettings,
  watermarkSettingsInput,
} from "../processing/watermark.js";
const id = z.string().regex(/^[a-f0-9]{24}$/i);
const taxInput = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    code: z.string().max(40).optional(),
    program: id.optional(),
    university: id.optional(),
    number: z.number().int().min(1).max(20).optional(),
    scheme: z.string().max(80).optional(),
    order: z.number().int().min(0).max(10000).default(0),
    active: z.boolean().default(true),
    verified: z.boolean().optional(),
    aliases: z.array(z.string().max(160)).max(30).optional(),
  })
  .strict();
const offeringInput = z
  .object({
    subject: id,
    branch: id,
    semester: id,
    program: id,
    scheme: z.string().max(80).default(""),
  })
  .strict();
async function validateTax(name: string, data: any) {
  if (name === "offerings") {
    const [subject, branch, semester, program] = await Promise.all(
      ["subjects", "branches", "semesters", "programs"].map((key, i) =>
        taxonomyModels[key].findById(
          data[["subject", "branch", "semester", "program"][i]],
        ),
      ),
    );
    if (
      !subject ||
      !branch ||
      !semester ||
      !program ||
      String(branch.program) !== String(data.program) ||
      String(semester.program) !== String(data.program)
    )
      throw new HttpError(
        400,
        "Offering must use existing, matching program relationships.",
      );
  } else {
    const required: Record<string, string[]> = {
      programs: ["university"],
      branches: ["program"],
      semesters: ["program", "number"],
      subjects: ["code"],
    };
    if ((required[name] || []).some((key) => !data[key]))
      throw new HttpError(400, `Missing required ${name} relationship/code.`);
    for (const key of ["program", "university"])
      if (
        data[key] &&
        !(await taxonomyModels[
          key === "program" ? "programs" : "universities"
        ].exists({ _id: data[key] }))
      )
        throw new HttpError(400, "Taxonomy parent does not exist.");
  }
}
export async function mergeTaxonomy(name: string, from: string, to: string) {
  if (!["subjects", "branches", "semesters"].includes(name) || from === to)
    throw new HttpError(400, "Select two distinct compatible records.");
  const model = taxonomyModels[name],
    source = await model.findById(from),
    target = await model.findById(to);
  if (!source || !target) throw new HttpError(404, "Taxonomy record not found");
  if (name !== "subjects" && String(source.program) !== String(target.program))
    throw new HttpError(400, "Cannot merge across programs.");
  const key = {
      subjects: "subject",
      branches: "branch",
      semesters: "semester",
    }[name],
    session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const offerings = await SubjectOffering.find({ [key]: from }).session(
        session,
      );
      for (const offering of offerings) {
        const match: any = {
          subject: offering.subject,
          branch: offering.branch,
          semester: offering.semester,
          scheme: offering.scheme,
        };
        match[key] = to;
        const duplicate = await SubjectOffering.findOne(match).session(session);
        if (duplicate) {
          for (const content of Object.values(contentModels)) {
            await content.updateMany(
              { offerings: offering._id },
              { $addToSet: { offerings: duplicate._id } },
              { session },
            );
            await content.updateMany(
              { offerings: offering._id },
              { $pull: { offerings: offering._id } },
              { session },
            );
          }
          await SubjectOffering.deleteOne({ _id: offering._id }, { session });
        } else
          await SubjectOffering.updateOne(
            { _id: offering._id },
            { $set: { [key]: to } },
            { session },
          );
      }
      await model.updateOne(
        { _id: to },
        {
          $addToSet: {
            aliases: { $each: [source.slug, source.name, ...source.aliases] },
          },
        },
        { session },
      );
      await model.updateOne(
        { _id: from },
        { $set: { active: false } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}
export const adminRouter = Router();
adminRouter.get("/settings/watermark", async (_req, res) => {
  const { settings, revision } = await getWatermarkSettings();
  ok(res, { settings, revision, defaults: defaultWatermark });
});
adminRouter.put("/settings/watermark", async (req: AuthRequest, res) => {
  const value = watermarkSettingsInput.parse(req.body);
  if (!value.template.includes("{subjectCode}") && !value.template.trim())
    throw new HttpError(400, "Enter watermark text.");
  const saved: any = await Setting.findOneAndUpdate(
    { key: "watermark" },
    { $set: { value, updatedBy: req.user._id }, $inc: { revision: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  await audit(req, "watermark-settings", "settings/watermark", {
    revision: saved.revision,
    template: value.template,
    enabled: value.enabled,
  });
  ok(res, { settings: value, revision: saved.revision });
});
// Re-apply the current watermark: dry run reports the count first; the job swaps files in place.
const applyInput = z
  .object({
    scope: z.enum(["selected", "all"]),
    items: z
      .array(z.object({ kind: z.enum(["papers", "notes"]), id }).strict())
      .max(500)
      .default([]),
    onlyOutdated: z.boolean().default(true),
    dryRun: z.boolean().default(false),
  })
  .strict();
adminRouter.post("/watermark/apply", async (req: AuthRequest, res) => {
  const input = applyInput.parse(req.body);
  const { revision } = await getWatermarkSettings();
  const targets: { kind: "papers" | "notes"; id: unknown }[] = [];
  for (const [kind, model] of Object.entries(contentModels) as [
    "papers" | "notes",
    any,
  ][]) {
    const ids = input.items.filter((i) => i.kind === kind).map((i) => i.id);
    if (input.scope === "selected" && !ids.length) continue;
    const filter: any = {
      deletedAt: null,
      asset: { $ne: null },
      format: { $ne: "markdown" },
      ...(input.scope === "selected" ? { _id: { $in: ids } } : {}),
      ...(input.onlyOutdated
        ? {
            $or: [
              { "watermark.revision": { $ne: revision } },
              { "watermark.status": { $nin: ["done", "skipped"] } },
            ],
          }
        : {}),
    };
    for (const row of await model.find(filter).select("_id").lean())
      targets.push({ kind, id: row._id });
  }
  if (input.dryRun) return ok(res, { count: targets.length, revision });
  const batch = randomUUID();
  for (const target of targets)
    await enqueueWatermark(target.kind, target.id, {
      requestedBy: req.user._id,
      batch,
    });
  await audit(req, "watermark-apply", "settings/watermark", {
    batch,
    count: targets.length,
    scope: input.scope,
  });
  ok(res, { batch, queued: targets.length, revision });
});
// Finds published PDFs whose cover thumbnail is missing (no key, or the object is gone).
adminRouter.post("/thumbnails/repair", async (req: AuthRequest, res) => {
  const { dryRun } = z
    .object({ dryRun: z.boolean().default(false) })
    .strict()
    .parse(req.body);
  const targets: { kind: "papers" | "notes"; id: unknown }[] = [];
  for (const [kind, model] of Object.entries(contentModels) as [
    "papers" | "notes",
    any,
  ][]) {
    const rows = await model
      .find({
        deletedAt: null,
        asset: { $ne: null },
        format: { $ne: "markdown" },
      })
      .select("_id asset")
      .lean();
    const assets = new Map(
      (
        await FileAsset.find({ _id: { $in: rows.map((r: any) => r.asset) } })
          .select("thumbnailKey")
          .lean()
      ).map((a: any) => [String(a._id), a.thumbnailKey]),
    );
    const checks = rows.map((row: any) => async () => {
      const key = assets.get(String(row.asset));
      if (key)
        try {
          await storage.head(key);
          return;
        } catch {
          /* missing object: repair */
        }
      targets.push({ kind, id: row._id });
    });
    for (let i = 0; i < checks.length; i += 8)
      await Promise.all(checks.slice(i, i + 8).map((check) => check()));
  }
  if (dryRun) return ok(res, { count: targets.length });
  const batch = randomUUID();
  for (const target of targets)
    await enqueueJob("thumbnail", target.kind, target.id, {
      requestedBy: req.user._id,
      batch,
    });
  await audit(req, "thumbnails-repair", "thumbnails", {
    batch,
    count: targets.length,
  });
  ok(res, { batch, queued: targets.length });
});
adminRouter.get("/jobs/summary", async (req, res) => {
  const batch = req.query.batch
    ? z.string().uuid().parse(req.query.batch)
    : undefined;
  const match = batch
    ? { batch }
    : { createdAt: { $gte: new Date(Date.now() - 86_400_000) } };
  const [counts, failed] = await Promise.all([
    ProcessingJob.aggregate([
      { $match: match },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    ProcessingJob.find({ ...match, status: "failed" })
      .select("contentType content error finishedAt")
      .sort({ finishedAt: -1 })
      .limit(20)
      .lean(),
  ]);
  ok(res, {
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    failed,
  });
});
adminRouter.get("/dashboard", async (_req, res) => {
  const [papers, notes, downloads, contributors, pending, today] =
    await Promise.all([
      Paper.countDocuments({ deletedAt: null }),
      Note.countDocuments({ deletedAt: null }),
      Promise.all(
        [Paper, Note].map((model) =>
          model.aggregate([
            { $group: { _id: null, total: { $sum: "$downloads" } } },
          ]),
        ),
      ).then((rows) => rows.flat()),
      User.countDocuments({ role: "contributor" }),
      Promise.all([
        Paper.countDocuments({ status: "pending", deletedAt: null }),
        Note.countDocuments({ status: "pending", deletedAt: null }),
      ]).then((a) => a.reduce((n, v) => n + v, 0)),
      DailyStats.findOne({ day: dayKey() }).lean(),
    ]);
  ok(res, {
    papers,
    notes,
    downloads: downloads.reduce((total, row) => total + row.total, 0),
    contributors,
    pending,
    visitors: today?.visitors || 0,
  });
});
adminRouter.get("/moderation", async (_req, res) => {
  const [papers, notes] = await Promise.all(
    [Paper, Note].map((m) =>
      m
        .find({ status: "pending", deletedAt: null })
        .populate("author", "name")
        .sort({ createdAt: 1 })
        .limit(200)
        .lean(),
    ),
  );
  ok(res, { papers, notes });
});
for (const [name, model] of Object.entries(taxonomyModels)) {
  const schema = name === "offerings" ? offeringInput : taxInput;
  adminRouter.get(`/taxonomy/${name}`, async (_req, res) =>
    ok(res, await model.find().sort({ order: 1, name: 1 }).lean()),
  );
  adminRouter.post(`/taxonomy/${name}`, async (req: AuthRequest, res) => {
    const data = schema.parse(req.body);
    await validateTax(name, data);
    const item = await model.create(data);
    await audit(req, "taxonomy-create", `${name}/${item._id}`);
    res.status(201);
    ok(res, item);
  });
  adminRouter.patch(`/taxonomy/${name}/:id`, async (req: AuthRequest, res) => {
    const item = await model.findById(identifier(req.params.id));
    if (!item) throw new HttpError(404, "Taxonomy not found");
    const data = parsePatch(schema, req.body);
    const merged = { ...item.toObject(), ...data };
    await validateTax(name, merged);
    Object.assign(item, data);
    await item.save();
    await audit(req, "taxonomy-edit", `${name}/${item._id}`);
    ok(res, item);
  });
  adminRouter.delete(`/taxonomy/${name}/:id`, async (req: AuthRequest, res) => {
    const recordId = identifier(req.params.id);
    const key = {
      universities: "university",
      programs: "program",
      branches: "branch",
      semesters: "semester",
      subjects: "subject",
    }[name];
    let referenced = false;
    if (name === "offerings")
      referenced =
        !!(await Paper.exists({ offerings: recordId })) ||
        !!(await Note.exists({ offerings: recordId }));
    else if (name === "universities")
      referenced = !!(await taxonomyModels.programs.exists({
        university: recordId,
      }));
    else if (name === "programs")
      referenced =
        !!(await taxonomyModels.branches.exists({ program: recordId })) ||
        !!(await taxonomyModels.semesters.exists({ program: recordId }));
    else referenced = !!(await SubjectOffering.exists({ [key]: recordId }));
    if (referenced)
      throw new HttpError(
        409,
        "This taxonomy is referenced. Merge it or mark it inactive.",
      );
    const deleted = await model.findByIdAndDelete(recordId);
    if (!deleted) throw new HttpError(404, "Record not found");
    await audit(req, "taxonomy-delete", `${name}/${recordId}`);
    ok(res, { deleted: true });
  });
  adminRouter.post(`/taxonomy/${name}/merge`, async (req: AuthRequest, res) => {
    const input = z.object({ from: id, to: id }).strict().parse(req.body);
    await mergeTaxonomy(name, input.from, input.to);
    await audit(req, "taxonomy-merge", `${name}/${input.from}`, {
      to: input.to,
    });
    ok(res, { merged: true });
  });
  adminRouter.post(
    `/taxonomy/${name}/reorder`,
    async (req: AuthRequest, res) => {
      const input = z
        .object({ ids: z.array(id).max(500) })
        .strict()
        .parse(req.body);
      if (new Set(input.ids).size !== input.ids.length)
        throw new HttpError(400, "Duplicate identifiers");
      await model.bulkWrite(
        input.ids.map((key, i) => ({
          updateOne: { filter: { _id: key }, update: { $set: { order: i } } },
        })),
      );
      await audit(req, "taxonomy-reorder", name);
      ok(res, { reordered: true });
    },
  );
}
adminRouter.get("/contributors", async (_req, res) => {
  const users = await User.find({ role: "contributor" })
    .sort({ createdAt: -1 })
    .lean();
  const [papers, notes] = await Promise.all(
    [Paper, Note].map((model) =>
      model.aggregate([
        {
          $group: {
            _id: "$author",
            total: { $sum: 1 },
            published: {
              $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] },
            },
          },
        },
      ]),
    ),
  );
  ok(
    res,
    users.map((u) => ({
      ...u,
      papers: papers.find((p) => String(p._id) === String(u._id))?.total || 0,
      notes: notes.find((p) => String(p._id) === String(u._id))?.total || 0,
    })),
  );
});
adminRouter.post("/contributors", async (req: AuthRequest, res) => {
  const data = z
    .object({
      name: z.string().min(2).max(160),
      email: z.email().max(254),
      temporaryPassword: newPasswordInput,
      trusted: z.boolean().default(false),
    })
    .strict()
    .parse(req.body);
  const user = await User.create({
    name: data.name,
    email: data.email.toLowerCase(),
    passwordHash: await bcrypt.hash(data.temporaryPassword, 12),
    role: "contributor",
    mustChangePassword: true,
    trusted: data.trusted,
  });
  await audit(req, "contributor-created", String(user._id));
  res.status(201);
  ok(res, { _id: user._id, name: user.name, email: user.email });
});
adminRouter.patch("/contributors/:id", async (req: AuthRequest, res) => {
  const data = z
    .object({
      active: z.boolean().optional(),
      trusted: z.boolean().optional(),
      name: z.string().min(2).max(160).optional(),
    })
    .strict()
    .parse(req.body);
  const user = await User.findOneAndUpdate(
    { _id: identifier(req.params.id), role: "contributor" },
    { $set: data },
    { returnDocument: "after" },
  );
  if (!user) throw new HttpError(404, "Contributor not found");
  if (data.active === false)
    await Session.updateMany(
      { user: user._id },
      { $set: { revokedAt: new Date() } },
    );
  await audit(req, "contributor-updated", String(user._id), data);
  ok(res, user);
});
adminRouter.post(
  "/contributors/:id/reset-password",
  async (req: AuthRequest, res) => {
    const password = newPasswordInput.parse(req.body.temporaryPassword);
    const user = await User.findOneAndUpdate(
      { _id: identifier(req.params.id), role: "contributor" },
      {
        $set: {
          passwordHash: await bcrypt.hash(password, 12),
          mustChangePassword: true,
          failedLogins: 0,
          lockedUntil: null,
        },
      },
    );
    if (!user) throw new HttpError(404, "Contributor not found");
    await Session.updateMany(
      { user: user._id },
      { $set: { revokedAt: new Date() } },
    );
    await audit(req, "contributor-password-reset", String(user._id));
    ok(res, { reset: true });
  },
);
adminRouter.get("/contributors/:id/history", async (req, res) => {
  const author = identifier(req.params.id);
  const [papers, notes] = await Promise.all(
    [Paper, Note].map((m) =>
      m.find({ author }).sort({ createdAt: -1 }).limit(200).lean(),
    ),
  );
  ok(res, { papers, notes });
});
for (const [name, model] of [
  ["reports", Report],
  ["requests", PaperRequest],
] as const) {
  adminRouter.get(`/${name}`, async (_req, res) =>
    ok(res, await model.find().sort({ createdAt: -1 }).limit(200).lean()),
  );
  adminRouter.patch(`/${name}/:id`, async (req: AuthRequest, res) => {
    const data = z
      .object({
        status: z.enum(["open", "in-progress", "resolved"]),
        response: z.string().max(2000).optional(),
      })
      .strict()
      .parse(req.body);
    const item = await model.findByIdAndUpdate(
      identifier(req.params.id),
      { $set: data },
      { returnDocument: "after" },
    );
    await audit(req, "inbox-updated", `${name}/${req.params.id}`);
    ok(res, item);
  });
}
adminRouter.get("/audit", async (req, res) => {
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
  const [data, total] = await Promise.all([
    AuditLog.find()
      .populate("actor", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * 50)
      .limit(50)
      .lean(),
    AuditLog.countDocuments(),
  ]);
  ok(res, data, { total, page, pages: Math.ceil(total / 50) });
});
