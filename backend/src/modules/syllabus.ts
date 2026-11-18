import { Router, type Response } from "express";
import { z } from "zod";
import { HttpError, identifier, ok } from "../lib/http.js";
import { slugify } from "../import/inventory.js";
import { audit, type AuthRequest } from "./auth.js";
import { Subject, SubjectOffering, Syllabus } from "./models.js";

/*
 * Subject syllabi. Admins write or import them as Markdown; each published syllabus gets
 * its own public page (/syllabus/<slug>), linked to the subject's question papers.
 */
const subjectFields = "name code slug";
const offeringPopulate = [
  { path: "program", select: "name slug" },
  { path: "branch", select: "name code slug order" },
  { path: "semester", select: "name number" },
];
const normalCode = (code: string) =>
  code.toUpperCase().replace(/\s+/g, "").replace(/^CS-/, "CSE-");
const isPlaceholder = (subject: { name: string; code: string }) =>
  normalCode(subject.name) === normalCode(subject.code);

/** Published syllabi with their subject and the branches/semesters that teach it. */
async function published(full: boolean, filter: Record<string, unknown> = {}) {
  const list = await Syllabus.find({ published: true, ...filter })
    .select(full ? "-updatedBy" : "-updatedBy -markdown")
    .populate({ path: "subject", select: `${subjectFields} active` })
    .sort({ slug: 1 })
    .lean<any[]>();
  const live = list.filter((s) => s.subject?.active !== false && s.subject);
  const offerings = await SubjectOffering.find({
    subject: { $in: live.map((s) => s.subject._id) },
  })
    .select("subject program branch semester")
    .populate(offeringPopulate)
    .lean<any[]>();
  return live.map(({ subject: { active: _active, ...subject }, ...s }) => ({
    ...s,
    subject,
    offerings: offerings
      .filter(
        (o) =>
          String(o.subject) === String(subject._id) &&
          o.program &&
          o.branch &&
          o.semester,
      )
      .map(({ subject: _subject, ...o }) => o),
  }));
}
function cache(res: Response) {
  res.set("Cache-Control", "public, max-age=300");
}

export const syllabusRouter = Router();
syllabusRouter.get("/syllabus", async (req, res) => {
  cache(res);
  ok(res, await published(req.query.full === "1"));
});
syllabusRouter.get("/syllabus/:slug", async (req, res) => {
  const slug = z.string().max(200).parse(req.params.slug);
  const [item] = await published(true, { slug });
  if (!item) throw new HttpError(404, "Syllabus not found");
  cache(res);
  ok(res, item);
});

const credits = z
  .object({
    L: z.number().int().min(0).max(20).optional(),
    T: z.number().int().min(0).max(20).optional(),
    P: z.number().int().min(0).max(20).optional(),
    total: z.number().min(0).max(40).optional(),
  })
  .strict();
const syllabusInput = z
  .object({
    markdown: z.string().trim().min(20).max(60_000),
    subtitle: z.string().trim().max(160).optional(),
    credits: credits.optional(),
    published: z.boolean().optional(),
  })
  .strict();
const importInput = z
  .object({
    items: z
      .array(
        z.object({
          code: z.string().trim().min(2).max(40),
          name: z.string().trim().min(2).max(160),
          subtitle: z.string().trim().max(160).optional(),
          credits: credits.optional(),
          markdown: z.string().trim().min(20).max(60_000),
          // Extra fields from the source file (branch, semester) are accepted and ignored.
          branch: z.string().max(40).optional(),
          semester: z.number().optional(),
        }),
      )
      .min(1)
      .max(200),
    rename: z.enum(["placeholders", "all", "none"]).default("placeholders"),
    dryRun: z.boolean().default(false),
  })
  .strict();

/** A unique, readable address: "be-101-engineering-mathematics-i". */
async function slugFor(subject: { _id: unknown; name: string; code: string }) {
  const base =
    (isPlaceholder(subject)
      ? slugify(subject.code)
      : slugify(`${subject.code} ${subject.name}`)
    ).slice(0, 90) || "syllabus";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await Syllabus.findOne({ slug })
      .select("subject")
      .lean<any>();
    if (!taken || String(taken.subject) === String(subject._id)) return slug;
  }
}
async function save(
  req: AuthRequest,
  subject: any,
  data: z.infer<typeof syllabusInput>,
) {
  const existing = await Syllabus.findOne({ subject: subject._id });
  if (existing) {
    Object.assign(existing, data, { updatedBy: req.user._id });
    await existing.save();
    return { syllabus: existing, created: false };
  }
  const syllabus = await Syllabus.create({
    ...data,
    subject: subject._id,
    slug: await slugFor(subject),
    updatedBy: req.user._id,
  });
  return { syllabus, created: true };
}

export const syllabusAdminRouter = Router();
syllabusAdminRouter.get("/syllabus", async (_req, res) => {
  ok(
    res,
    await Syllabus.find()
      .select("-updatedBy")
      .populate("subject", subjectFields)
      .sort({ slug: 1 })
      .lean(),
  );
});
syllabusAdminRouter.put(
  "/syllabus/:subjectId",
  async (req: AuthRequest, res) => {
    const subject = await Subject.findById(identifier(req.params.subjectId));
    if (!subject) throw new HttpError(404, "Subject not found");
    const { syllabus, created } = await save(
      req,
      subject,
      syllabusInput.parse(req.body),
    );
    await audit(
      req,
      created ? "syllabus-created" : "syllabus-edited",
      String(subject._id),
    );
    res.status(created ? 201 : 200);
    ok(res, syllabus);
  },
);
syllabusAdminRouter.delete(
  "/syllabus/:subjectId",
  async (req: AuthRequest, res) => {
    const subject = identifier(req.params.subjectId);
    const deleted = await Syllabus.findOneAndDelete({ subject });
    if (!deleted) throw new HttpError(404, "Syllabus not found");
    await audit(req, "syllabus-deleted", subject);
    ok(res, { deleted: true });
  },
);
/*
 * Bulk import from a JSON file: each item is matched to subjects by code ("CS-301" also
 * matches "CSE-301"). Placeholder subject names (a name that is just the code) are replaced
 * with the syllabus name unless told otherwise.
 */
syllabusAdminRouter.post("/syllabus/import", async (req: AuthRequest, res) => {
  const { items, rename, dryRun } = importInput.parse(req.body);
  const subjects = await Subject.find().select(subjectFields);
  const byCode = new Map<string, any[]>();
  for (const subject of subjects) {
    const key = normalCode(subject.code);
    byCode.set(key, [...(byCode.get(key) || []), subject]);
  }
  const result = {
    created: [] as string[],
    updated: [] as string[],
    renamed: [] as string[],
    unmatched: [] as string[],
  };
  for (const item of items) {
    const matches = byCode.get(normalCode(item.code)) || [];
    if (!matches.length) {
      result.unmatched.push(`${item.code} ${item.name}`);
      continue;
    }
    for (const subject of matches) {
      if (
        (rename === "all" ||
          (rename === "placeholders" && isPlaceholder(subject))) &&
        subject.name !== item.name
      ) {
        result.renamed.push(`${subject.code}: ${subject.name} → ${item.name}`);
        if (!dryRun) {
          subject.name = item.name;
          await subject.save();
        }
      }
      const exists = await Syllabus.exists({ subject: subject._id });
      result[exists ? "updated" : "created"].push(subject.code);
      if (!dryRun)
        await save(req, subject, {
          markdown: item.markdown,
          subtitle: item.subtitle,
          credits: item.credits,
        });
    }
  }
  if (!dryRun)
    await audit(req, "syllabus-imported", `${items.length} items`, {
      created: result.created.length,
      updated: result.updated.length,
      unmatched: result.unmatched.length,
    });
  ok(res, { ...result, dryRun });
});
