import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { publicName, publicPhoto } from "./profile.js";
import { HttpError, identifier, ok } from "../lib/http.js";
import {
  taxonomyModels,
  contentModels,
  Subject,
  SubjectOffering,
  publicationFilter,
  Paper,
  Note,
  User,
  ContributorRequest,
  Report,
  PaperRequest,
} from "./models.js";
const id = z.string().regex(/^[a-f0-9]{24}$/i);
// Every order ends with _id so pages never repeat or skip items with equal keys.
const sortOrders: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  downloads: { downloads: -1, _id: -1 },
  views: { views: -1, _id: -1 },
  "year-desc": { year: -1, createdAt: -1, _id: -1 },
  "year-asc": { year: 1, createdAt: -1, _id: -1 },
  title: { title: 1, _id: 1 },
};
const filters = z
  .object({
    q: z.string().max(120).optional(),
    branch: id.optional(),
    semester: id.optional(),
    subject: id.optional(),
    offering: id.optional(),
    year: z.coerce.number().int().min(1900).max(2200).optional(),
    examType: z
      .enum(["Mid-Sem", "End-Sem", "Supplementary", "Other", "Unknown"])
      .optional(),
    sort: z
      .enum([
        "newest",
        "oldest",
        "downloads",
        "views",
        "year-desc",
        "year-asc",
        "title",
      ])
      .default("newest"),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const privateFields =
  "-revisions -provenance -rejectionReason -files -watermark -activeVersion";
export const escaped = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function catalogFilter(raw: unknown, publicOnly = true) {
  const input = filters.parse(raw);
  const filter: any = publicOnly ? { ...publicationFilter } : {};
  if (input.branch || input.semester || input.subject || input.offering) {
    const query: any = {};
    for (const key of ["branch", "semester", "subject"])
      if (input[key]) query[key] = input[key];
    if (input.offering) query._id = input.offering;
    filter.offerings = {
      $in: (await SubjectOffering.find(query).select("_id").lean()).map(
        (o) => o._id,
      ),
    };
  }
  if (input.year) filter.year = input.year;
  if (input.examType) filter.examType = input.examType;
  if (input.q?.trim()) {
    const regex = new RegExp(escaped(input.q.trim()), "i");
    const subjects = await Subject.find({
      $or: [{ name: regex }, { code: regex }, { aliases: regex }],
    })
      .select("_id")
      .limit(50)
      .lean();
    const offerings = await SubjectOffering.find({
      subject: { $in: subjects.map((s) => s._id) },
    })
      .select("_id")
      .lean();
    filter.$or = [
      { title: regex },
      { tags: regex },
      { offerings: { $in: offerings.map((o) => o._id) } },
    ];
    if (/^20\d{2}$/.test(input.q)) filter.$or.push({ year: Number(input.q) });
  }
  return { input, filter };
}
export async function listContent(
  kind: string,
  raw: unknown,
  publicOnly = true,
) {
  const model = contentModels[kind];
  if (!model) throw new HttpError(404, "Unknown content type");
  const { input, filter } = await catalogFilter(raw, publicOnly);
  const [data, total] = await Promise.all([
    model
      .find(filter)
      .select(privateFields)
      .populate({
        path: "offerings",
        populate: [
          { path: "subject" },
          { path: "branch" },
          { path: "semester" },
          { path: "program" },
        ],
      })
      .populate("author", "name profile")
      .populate("asset", "key thumbnailKey deletedAt")
      .sort(sortOrders[input.sort])
      .collation({ locale: "en", strength: 2 })
      .skip((input.page - 1) * input.limit)
      .limit(input.limit)
      .lean(),
    model.countDocuments(filter),
  ]);
  return {
    data: data.map(withThumbnail),
    meta: { total, page: input.page, pages: Math.ceil(total / input.limit) },
  };
}
function withThumbnail(item: any) {
  const { asset, author, ...content } = item;
  if (author) content.author = { name: publicName(author) };
  const live = asset && !asset.deletedAt;
  return {
    ...content,
    hasThumbnail: Boolean(live && asset.thumbnailKey),
    // Served straight from storage by the Pages /files route (no API round trip).
    ...(live && asset.key?.startsWith("watermarked/")
      ? { publicFile: asset.key }
      : {}),
    ...(live && asset.thumbnailKey?.startsWith("thumbnails/")
      ? { thumbKey: asset.thumbnailKey }
      : {}),
  };
}
export function cached(req: any, res: any, data: unknown, meta?: unknown) {
  const body = JSON.stringify({ data, ...(meta ? { meta } : {}) });
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  res.set({
    "Cache-Control": "public, max-age=30, must-revalidate",
    ETag: etag,
  });
  if (req.get("If-None-Match") === etag) return res.status(304).end();
  res.type("json").send(body);
}
export const catalogRouter = Router();
for (const [name, model] of Object.entries(taxonomyModels)) {
  catalogRouter.get(`/${name}`, async (req, res) => {
    const query: any = { active: true };
    if (name === "offerings") delete query.active;
    for (const key of ["program", "branch", "semester", "subject"])
      if (req.query[key]) query[key] = identifier(req.query[key]);
    const data = await model
      .find(query)
      .sort({ order: 1, name: 1 })
      .populate(
        name === "offerings"
          ? [
              { path: "subject" },
              { path: "branch" },
              { path: "semester" },
              { path: "program" },
            ]
          : [],
      )
      .lean();
    cached(req, res, data);
  });
}
catalogRouter.get("/subjects/:id", async (req, res) => {
  const subject = await Subject.findOne({
    _id: identifier(req.params.id),
    active: true,
  }).lean();
  if (!subject) throw new HttpError(404, "Subject not found");
  const offerings = await SubjectOffering.find({ subject: subject._id })
    .populate("branch semester program")
    .lean();
  cached(req, res, { ...subject, offerings });
});
for (const kind of ["papers", "notes"]) {
  catalogRouter.get(`/${kind}`, async (req, res) => {
    const result = await listContent(kind, req.query);
    cached(req, res, result.data, result.meta);
  });
  catalogRouter.get(`/${kind}/:id`, async (req, res) => {
    const key = String(req.params.id);
    const query = /^[a-f0-9]{24}$/i.test(key) ? { _id: key } : { slug: key };
    const item = await contentModels[kind]
      .findOne({ ...query, ...publicationFilter })
      .select(privateFields)
      .populate({
        path: "offerings",
        populate: [
          { path: "subject" },
          { path: "branch" },
          { path: "semester" },
          { path: "program" },
        ],
      })
      .populate("author", "name profile")
      .populate("asset", "key thumbnailKey deletedAt")
      .lean();
    if (!item) throw new HttpError(404, "Content not found");
    cached(req, res, withThumbnail(item));
  });
}
catalogRouter.get("/papers/:id/related", async (req, res) => {
  const item = await Paper.findOne({
    _id: identifier(req.params.id),
    ...publicationFilter,
  });
  if (!item) throw new HttpError(404, "Paper not found");
  const related = await Paper.find({
    ...publicationFilter,
    _id: { $ne: item._id },
    offerings: { $in: item.offerings },
  })
    .select(privateFields)
    .sort({ year: -1 })
    .limit(8)
    .populate({
      path: "offerings",
      populate: ["subject", "branch", "semester", "program"],
    })
    .populate("author", "name profile")
    .populate("asset", "key thumbnailKey deletedAt")
    .lean();
  cached(req, res, related.map(withThumbnail));
});
const searchLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
catalogRouter.get("/search/suggestions", searchLimit, async (req, res) => {
  const query = z.string().min(2).max(120).parse(req.query.q);
  let subjects: any[];
  if (config.atlasSearch) {
    try {
      subjects = await Subject.aggregate([
        {
          $search: {
            index: "subject_autocomplete",
            autocomplete: { query, path: "name", fuzzy: { maxEdits: 1 } },
          },
        },
        { $match: { active: true } },
        { $limit: 8 },
        { $project: { name: 1, code: 1, slug: 1 } },
      ]);
    } catch {
      subjects = null;
    }
  }
  if (!subjects?.length) {
    const regex = new RegExp(escaped(query), "i");
    subjects = await Subject.find({
      active: true,
      $or: [{ name: regex }, { code: regex }, { aliases: regex }],
    })
      .select("name code slug")
      .limit(8)
      .lean();
  }
  if (subjects.length < 8) {
    const { filter } = await catalogFilter({ q: query });
    const resources = await Promise.all(
      [Paper, Note].map((model) =>
        model
          .find(filter)
          .select("title year slug")
          .limit(8 - subjects.length)
          .lean(),
      ),
    );
    subjects.push(
      ...resources
        .flat()
        .slice(0, 8 - subjects.length)
        .map((item) => ({
          _id: item._id,
          name: item.title,
          slug: item.slug,
          code: item.year ? String(item.year) : "",
        })),
    );
  }
  ok(res, subjects);
});
catalogRouter.get("/search", searchLimit, async (req, res) => {
  const query = { q: z.string().max(120).parse(req.query.q), limit: 10 };
  const [papers, notes] = await Promise.all([
    listContent("papers", query),
    listContent("notes", query),
  ]);
  ok(res, {
    papers: papers.data,
    notes: notes.data,
    total: papers.meta.total + notes.meta.total,
  });
});
// Public leaderboard: names and counts only (no emails or ids). Admin uploads and legacy imports are excluded.
catalogRouter.get("/contributors", async (req, res) => {
  const period = z
    .enum(["all", "year", "month"])
    .default("all")
    .parse(req.query.period);
  const match: Record<string, unknown> = {
    ...publicationFilter,
    author: { $ne: null },
  };
  if (period !== "all")
    match.publishedAt = {
      $gte: new Date(Date.now() - (period === "year" ? 365 : 30) * 86_400_000),
    };
  const [papers, notes] = await Promise.all(
    [Paper, Note].map((model) =>
      model.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$author",
            total: { $sum: 1 },
            downloads: { $sum: "$downloads" },
            first: { $min: "$publishedAt" },
          },
        },
      ]),
    ),
  );
  const ids = [...new Set([...papers, ...notes].map((row) => String(row._id)))];
  const users = await User.find({
    _id: { $in: ids },
    role: "contributor",
    active: { $ne: false },
  })
    .select("name createdAt profile")
    .lean();
  const count = (rows: any[], id: string) =>
    rows.find((row) => String(row._id) === id);
  const board = users
    .map((user: any) => {
      const id = String(user._id),
        p = count(papers, id),
        n = count(notes, id),
        firsts = [p?.first, n?.first].filter(Boolean) as Date[];
      return {
        name: publicName(user) as string,
        photo: publicPhoto(user),
        bio:
          user.profile?.visibility === "anonymous"
            ? null
            : user.profile?.bio || null,
        anonymous: user.profile?.visibility === "anonymous",
        papers: p?.total || 0,
        notes: n?.total || 0,
        total: (p?.total || 0) + (n?.total || 0),
        downloads: (p?.downloads || 0) + (n?.downloads || 0),
        joinedAt: user.createdAt as Date,
        firstPublishedAt: firsts.length
          ? new Date(Math.min(...firsts.map((d) => +new Date(d))))
          : null,
      };
    })
    .filter((row) => row.total > 0)
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.downloads - a.downloads ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 50)
    .map((row, index) => ({ rank: index + 1, ...row }));
  cached(req, res, board);
});
// Students on one college network share an address; keep room for a few of them.
const requestLimit = rateLimit({
  windowMs: 3600_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const contributorRequestInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().max(254),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 -]{7,18}$/, "Enter a valid phone number.")
      .optional()
      .or(z.literal("")),
    branch: z.string().trim().max(80).optional(),
    semester: z.coerce.number().int().min(1).max(12).optional(),
    institution: z.string().trim().max(160).optional(),
    message: z.string().trim().min(20).max(1500),
    consent: z.literal(true, "Please confirm you may share these files."),
    // Bot trap: humans never see or fill this field.
    website: z.string().max(200).optional(),
  })
  .strict();
catalogRouter.post("/contributor-requests", requestLimit, async (req, res) => {
  const {
    website,
    consent: _consent,
    ...data
  } = contributorRequestInput.parse(req.body);
  // Same answer in every case, so the form cannot reveal who already has an account.
  const received = () => {
    res.status(201);
    ok(res, { received: true });
  };
  if (website) return received();
  const email = data.email.toLowerCase();
  const existingAccount = Boolean(await User.exists({ email }));
  const open = await ContributorRequest.findOne({ email, status: "open" });
  if (open) {
    Object.assign(open, data, { email, existingAccount });
    await open.save();
  } else await ContributorRequest.create({ ...data, email, existingAccount });
  received();
});
catalogRouter.get("/stats", async (req, res) => {
  const [papers, notes, downloads] = await Promise.all([
    Paper.countDocuments(publicationFilter),
    Note.countDocuments(publicationFilter),
    Promise.all(
      [Paper, Note].map((model) =>
        model.aggregate([
          { $match: publicationFilter },
          { $group: { _id: null, total: { $sum: "$downloads" } } },
        ]),
      ),
    ).then((rows) => rows.flat()),
  ]);
  cached(req, res, {
    papers,
    notes,
    downloads: downloads.reduce((total, row) => total + row.total, 0),
  });
});
const inboxLimit = rateLimit({
  windowMs: 3600_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const submission = z
  .object({
    message: z.string().trim().min(10).max(2000),
    email: z.email().max(254).optional().or(z.literal("")),
    contentType: z.enum(["papers", "notes"]).optional(),
    content: id.optional(),
    offering: id.optional(),
    year: z.coerce.number().int().min(1900).max(2200).optional(),
  })
  .strict();
for (const [name, model] of [
  ["reports", Report],
  ["paper-requests", PaperRequest],
] as const)
  catalogRouter.post(`/${name}`, inboxLimit, async (req, res) => {
    const data = submission.parse(req.body);
    await model.create(data);
    res.status(201);
    ok(res, { received: true });
  });
