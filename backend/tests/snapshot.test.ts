import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Paper, Note } from "../src/modules/models.js";

const root = resolve(import.meta.dirname, "../..");
let db: MongoMemoryReplSet;
before(async () => {
  db = await MongoMemoryReplSet.create({
    binary: {
      downloadDir: resolve(root, "node_modules/.cache/mongodb-memory-server"),
    },
    replSet: { count: 1 },
  });
  await mongoose.connect(db.getUri());
});
after(async () => {
  await mongoose.disconnect();
  await db?.stop();
});

test("snapshot CLI writes the requested artifact using only public fields and records", async () => {
  await Paper.create([
    {
      title: "Public fixture",
      slug: "public-fixture",
      status: "published",
      downloads: 3,
      metadataNeedsReview: true,
      provenance: { secret: "private source" },
      rejectionReason: "staff comment",
      revisions: [{ replacedAt: new Date() }],
    },
    { title: "Pending fixture", slug: "pending-fixture", status: "pending" },
    {
      title: "Deleted fixture",
      slug: "deleted-fixture",
      status: "published",
      deletedAt: new Date(),
    },
  ]);
  await Note.create({
    title: "Public note",
    slug: "public-note",
    status: "published",
    format: "markdown",
    markdown: "Published note text",
    downloads: 2,
  });
  const temp = await mkdtemp(resolve(root, ".npm-cache/snapshot-test-"));
  const output = resolve(temp, "snapshot.json");
  const publicPath = resolve(root, "frontend/public/snapshot.json");
  const original = await readFile(publicPath);
  try {
    await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "backend/scripts/export-snapshot.ts",
        "--output",
        output,
      ],
      {
        cwd: root,
        env: { ...process.env, NODE_ENV: "test", MONGODB_URI: db.getUri() },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    assert.ok(
      existsSync(output),
      "export must write the requested artifact rather than overwrite the site snapshot",
    );
    const snapshot = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(
      snapshot.papers.map((p: any) => p.title),
      ["Public fixture"],
    );
    assert.equal(snapshot.notes[0].markdown, "Published note text");
    assert.deepEqual(snapshot.stats, { papers: 1, notes: 1, downloads: 5 });
    for (const field of [
      "asset",
      "author",
      "provenance",
      "revisions",
      "rejectionReason",
      "metadataNeedsReview",
      "deletedAt",
    ])
      assert.equal(
        field in snapshot.papers[0],
        false,
        `private field ${field} must not appear in the fallback`,
      );
    assert.deepEqual(await readFile(publicPath), original);
  } finally {
    await writeFile(publicPath, original);
    await rm(temp, { recursive: true, force: true });
  }
});

test("invalid snapshots preserve the previous fallback instead of publishing private fields or bad totals", async () => {
  const { buildPublishedSnapshot, writeSnapshotAtomic } =
    await import("../src/snapshot.js");
  const snapshot = await buildPublishedSnapshot();
  const temp = await mkdtemp(resolve(root, ".npm-cache/atomic-snapshot-"));
  const path = resolve(temp, "snapshot.json");
  try {
    await writeSnapshotAtomic(path, snapshot);
    const previous = await readFile(path);
    const privateData = structuredClone(snapshot);
    (privateData.papers[0] as any).asset = {
      key: "private.pdf",
      url: "https://example.test/file?X-Amz-Signature=secret",
    };
    await assert.rejects(writeSnapshotAtomic(path, privateData));
    await assert.rejects(
      writeSnapshotAtomic(path, {
        ...snapshot,
        stats: { ...snapshot.stats, downloads: 99 },
      }),
    );
    await assert.rejects(
      writeSnapshotAtomic(path, {
        ...snapshot,
        papers: [{ ...snapshot.papers[0], status: "pending" }],
      }),
    );
    assert.deepEqual(await readFile(path), previous);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
