import { z } from "zod";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import {
  taxonomyModels,
  Paper,
  Note,
  publicationFilter,
} from "./modules/models.js";

const id = z.string().regex(/^[a-f0-9]{24}$/i);
const entityFields =
  "_id name slug code number program university order active aliases scheme semester notice verified originalLabel";
const entity = z
  .object({
    _id: id,
    name: z.string(),
    slug: z.string(),
    code: z.string().optional(),
    number: z.number().optional(),
    program: id.optional(),
    university: id.optional(),
    order: z.number().optional(),
    active: z.boolean().optional(),
    aliases: z.array(z.string()).optional(),
    scheme: z.string().optional(),
    semester: z.number().optional(),
    notice: z.string().optional(),
    verified: z.boolean().optional(),
    originalLabel: z.string().optional(),
  })
  .strict();
const offering = z
  .object({
    _id: id,
    subject: entity,
    branch: entity,
    semester: entity,
    program: entity,
    scheme: z.string().optional(),
  })
  .strict();
const date = z.iso.datetime().nullable().optional();
const content = z
  .object({
    _id: id,
    title: z.string().max(240),
    slug: z.string(),
    offerings: z.array(offering),
    year: z.number().int().optional(),
    session: z.string().optional(),
    examType: z.string().optional(),
    scheme: z.string().optional(),
    credit: z.string().optional(),
    tags: z.array(z.string()).optional(),
    featured: z.boolean().optional(),
    format: z.enum(["pdf", "markdown"]).optional(),
    markdown: z.string().max(100_000).optional(),
    unit: z.string().optional(),
    topic: z.string().optional(),
    status: z.literal("published").optional(),
    publishedAt: date,
    createdAt: date,
    updatedAt: date,
    downloads: z.number().int().nonnegative(),
    views: z.number().int().nonnegative(),
    sourceArchive: z.boolean().optional(),
    hasThumbnail: z.boolean().optional(),
  })
  .strict();
const contentFields = Object.keys(content.shape)
  .filter((field) => !["hasThumbnail", "sourceArchive"].includes(field))
  .join(" ");

export const snapshotSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    source: z.enum(["published-database", "legacy-archive"]),
    universities: z.array(entity).optional(),
    programs: z.array(entity),
    branches: z.array(entity),
    semesters: z.array(entity),
    subjects: z.array(entity),
    offerings: z.array(offering),
    papers: z.array(content),
    notes: z.array(content),
    stats: z
      .object({
        papers: z.number().int().nonnegative(),
        notes: z.number().int().nonnegative(),
        downloads: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (
      snapshot.stats.papers !== snapshot.papers.length ||
      snapshot.stats.notes !== snapshot.notes.length ||
      snapshot.stats.downloads !==
        [...snapshot.papers, ...snapshot.notes].reduce(
          (n, item) => n + item.downloads,
          0,
        )
    )
      ctx.addIssue({
        code: "custom",
        message: "Snapshot totals do not match published content",
        path: ["stats"],
      });
    for (const kind of ["papers", "notes"] as const)
      if (
        new Set(snapshot[kind].map((item) => item._id)).size !==
        snapshot[kind].length
      )
        ctx.addIssue({
          code: "custom",
          message: "Duplicate content identifiers",
          path: [kind],
        });
  });

const offeringPopulation = ["subject", "branch", "semester", "program"].map(
  (path) => ({ path, select: entityFields }),
);
export async function buildPublishedSnapshot() {
  const snapshot: any = {
    generatedAt: new Date().toISOString(),
    source: "published-database",
  };
  for (const [name, model] of Object.entries(taxonomyModels)) {
    snapshot[name] = await model
      .find(name === "offerings" ? {} : { active: true })
      .select(
        name === "offerings"
          ? "_id subject branch semester program scheme"
          : entityFields,
      )
      .populate(name === "offerings" ? offeringPopulation : [])
      .sort({ order: 1, _id: 1 })
      .lean();
  }
  for (const [kind, model] of [
    ["papers", Paper],
    ["notes", Note],
  ] as const) {
    const items = await model
      .find(publicationFilter)
      .select(`${contentFields} asset`)
      .populate({
        path: "offerings",
        select: "_id subject branch semester program scheme",
        populate: offeringPopulation,
      })
      .populate("asset", "thumbnailKey deletedAt")
      .sort({ createdAt: -1, _id: -1 })
      .lean();
    snapshot[kind] = items.map(({ asset, ...item }: any) => ({
      ...item,
      hasThumbnail: Boolean(asset?.thumbnailKey && !asset.deletedAt),
    }));
  }
  snapshot.stats = {
    papers: snapshot.papers.length,
    notes: snapshot.notes.length,
    downloads: [...snapshot.papers, ...snapshot.notes].reduce(
      (n, item) => n + item.downloads,
      0,
    ),
  };
  return snapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
}

export async function writeSnapshotAtomic(path: string, snapshot: unknown) {
  const validated = snapshotSchema.parse(snapshot);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(validated), { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return validated;
}
