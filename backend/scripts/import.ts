import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { buildInventory, slugify } from "../src/import/inventory.js";
import { config } from "../src/config.js";
import {
  University,
  Program,
  Branch,
  Semester,
  Subject,
  SubjectOffering,
  FileAsset,
  Paper,
} from "../src/modules/models.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inventory = await buildInventory(root);
await mkdir(resolve(root, "migration"), { recursive: true });
await writeFile(
  resolve(root, "migration/manifest.json"),
  JSON.stringify(inventory, null, 2),
);
console.info(
  `${inventory.sourceFileCount} source paths; ${inventory.assets.length} distinct PDFs; ${inventory.subjects.length} catalog subjects.`,
);
console.info(
  `${inventory.assets.filter((a) => a.conflicts.length).length} files need metadata review. See migration/manifest.json.`,
);
if (!process.argv.includes("--dry-run")) {
  const { storage } = await import("../src/storage/index.js");
  await mongoose.connect(config.mongoUri);
  const upsert = (model: mongoose.Model<any>, filter: object, data: object) =>
    model.findOneAndUpdate(
      filter,
      { $setOnInsert: data },
      { upsert: true, returnDocument: "after", runValidators: true },
    );
  try {
    const uni = await upsert(
      University,
      { slug: "barkatullah" },
      {
        name: "Barkatullah University",
        slug: "barkatullah",
        notice: "Unofficial student resource created by Ajeet Soni and team.",
      },
    );
    const program = await upsert(
      Program,
      { slug: "btech" },
      { name: "B.Tech", slug: "btech", university: uni._id },
    );
    const branches = new Map();
    for (const [i, branch] of inventory.branches.entries())
      branches.set(
        branch.code,
        await upsert(
          Branch,
          { program: program._id, slug: branch.slug },
          { ...branch, program: program._id, order: i },
        ),
      );
    const semesters = new Map();
    for (let i = 1; i <= 8; i++)
      semesters.set(
        i,
        await upsert(
          Semester,
          { program: program._id, number: i },
          {
            program: program._id,
            number: i,
            name: `Semester ${i}`,
            slug: `sem-${i}`,
            order: i,
          },
        ),
      );
    const offerings = new Map();
    for (const s of inventory.subjects) {
      const subject = await upsert(
        Subject,
        { code: s.code },
        { ...s, slug: slugify(s.code), verified: false },
      );
      offerings.set(
        s.code,
        await upsert(
          SubjectOffering,
          {
            subject: subject._id,
            branch: branches.get("CSE")._id,
            semester: semesters.get(s.semester)._id,
            scheme: "",
          },
          {
            subject: subject._id,
            branch: branches.get("CSE")._id,
            semester: semesters.get(s.semester)._id,
            program: program._id,
            scheme: "",
          },
        ),
      );
    }
    for (const a of inventory.assets) {
      let asset = await FileAsset.findOne({ hash: a.hash });
      if (!asset) {
        const key = `legacy/${a.hash}.pdf`;
        await storage.put(
          key,
          await readFile(resolve(root, a.sources[0])),
          "application/pdf",
        );
        asset = await FileAsset.create({
          key,
          hash: a.hash,
          size: a.size,
          mime: "application/pdf",
          originalName: a.originalName,
          sources: a.sources,
        });
      }
      await upsert(
        Paper,
        { "provenance.hash": a.hash },
        {
          title: a.title,
          slug: `${slugify(a.originalName.replace(/\.pdf$/i, ""))}-${a.hash.slice(0, 8)}`,
          asset: asset._id,
          offerings: offerings.has(a.code) ? [offerings.get(a.code)._id] : [],
          year: a.year,
          session: a.session,
          examType: "Unknown",
          status: a.conflicts.length ? "pending" : "published",
          publishedAt: a.conflicts.length ? undefined : new Date(),
          metadataNeedsReview: !!a.conflicts.length,
          provenance: a,
        },
      );
    }
    console.info(
      "Import complete. Re-running preserves existing moderation/edit decisions.",
    );
  } finally {
    await mongoose.disconnect();
  }
}
