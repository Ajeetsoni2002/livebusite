import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import dotenv from "dotenv";
import {
  buildPublishedSnapshot,
  writeSnapshotAtomic,
} from "../src/snapshot.js";
import { buildInventory, slugify } from "../src/import/inventory.js";
dotenv.config({ quiet: true });
async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
    pub = resolve(root, "frontend/public");
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex !== -1 && !process.argv[outputIndex + 1])
    throw new Error("--output requires a file path");
  const output =
    outputIndex === -1
      ? resolve(pub, "snapshot.json")
      : resolve(process.argv[outputIndex + 1]);
  await mkdir(resolve(pub, "branding"), { recursive: true });
  await copyFile(
    resolve(root, "images/logo.png"),
    resolve(pub, "branding/crest.png"),
  );
  await copyFile(
    resolve(root, "images/text logo2.png"),
    resolve(pub, "branding/buit.png"),
  );
  let snapshot: any;
  if (process.argv.includes("--legacy")) {
    const inventory = await buildInventory(root),
      id = (value: string) =>
        createHash("sha256").update(value).digest("hex").slice(0, 24);
    const programs = [{ _id: id("btech"), name: "B.Tech", slug: "btech" }],
      branches = inventory.branches.map((b) => ({
        ...b,
        _id: id(b.code),
        program: programs[0]._id,
      }));
    const semesters = Array.from({ length: 8 }, (_, i) => ({
      _id: id(`sem${i + 1}`),
      name: `Semester ${i + 1}`,
      slug: `sem-${i + 1}`,
      number: i + 1,
      program: programs[0]._id,
    }));
    const subjects = inventory.subjects.map((s) => ({
      ...s,
      _id: id(s.code),
      slug: slugify(s.code),
    }));
    const offerings = subjects.map((s) => ({
      _id: id(`offering:${s.code}`),
      subject: s,
      branch: branches[0],
      semester: semesters[s.semester - 1],
      program: programs[0],
    }));
    const papers = inventory.assets
      .filter((a) => !a.conflicts.length)
      .map((a) => ({
        _id: a.hash.slice(0, 24),
        title: a.title,
        slug: `${slugify(a.originalName.replace(/\.pdf$/i, ""))}-${a.hash.slice(0, 8)}`,
        year: a.year,
        session: a.session,
        examType: "Unknown",
        offerings: offerings.filter((o) => o.subject.code === a.code),
        downloads: 0,
        views: 0,
        createdAt: null,
        sourceArchive: true,
      }));
    snapshot = {
      generatedAt: new Date().toISOString(),
      source: "legacy-archive",
      programs,
      branches,
      semesters,
      subjects,
      offerings,
      papers,
      notes: [],
      stats: { papers: papers.length, notes: 0, downloads: 0 },
    };
  } else {
    const mongoUri =
      process.env.SNAPSHOT_MONGODB_URI || process.env.MONGODB_URI;
    if (!mongoUri && (process.env.CI || process.env.NODE_ENV === "production"))
      throw new Error("Snapshot export requires a read-only MongoDB URI");
    await mongoose.connect(
      mongoUri || "mongodb://127.0.0.1:27018/buit_papers?replicaSet=testset",
      { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15_000 },
    );
    try {
      snapshot = await buildPublishedSnapshot();
    } finally {
      await mongoose.disconnect();
    }
  }
  await writeSnapshotAtomic(output, snapshot);
  console.info(
    `Snapshot exported: ${snapshot.papers.length} papers, ${snapshot.notes.length} notes. No signed URLs or private records.`,
  );
}
await main().catch(() => {
  console.error(
    "Snapshot export failed. The previous snapshot was preserved. Check database access and published metadata locally.",
  );
  process.exitCode = 1;
});
