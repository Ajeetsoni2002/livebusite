import mongoose from "mongoose";
import { config } from "../src/config.js";
import {
  AuditLog,
  contentModels,
  FileAsset,
  ProcessingJob,
} from "../src/modules/models.js";
import {
  computeFingerprint,
  duplicatePairs,
  fingerprintContent,
  unscannedFilter,
} from "../src/processing/fingerprint.js";
import { compareFingerprints } from "../src/lib/fingerprint.js";
import { storage } from "../src/storage/index.js";

/*
 * Finds papers and notes whose content is the same and keeps one of each.
 *
 *   npx tsx scripts/dedupe-content.ts                 report only (nothing changes)
 *   npx tsx scripts/dedupe-content.ts --apply         soft-delete the copies
 *   --threshold 0.98   share of content from which two items count as identical
 *   --skip-backfill    do not compute missing fingerprints first
 *   --self-check       also compare each original with its processed version
 *
 * Items without a fingerprint are fingerprinted first (their source PDF is read from
 * storage, so point STORAGE_DRIVER and the S3 settings at the live bucket). Copies are
 * soft-deleted (deletedAt), never removed; their subject offerings, downloads and views
 * move to the kept item so nothing disappears from the catalogue.
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const apply = flag("--apply");
const threshold = Number(option("--threshold", "0.98"));
type Kind = "papers" | "notes";
const kinds = Object.keys(contentModels) as Kind[];

const label = (item: any) =>
  `${item.title} [${item.status}${item.year ? `, ${item.year}` : ""}; ${item.downloads || 0} downloads; ${new Date(item.createdAt).toISOString().slice(0, 10)}]`;

async function backfill() {
  for (const kind of kinds) {
    const rows: any[] = await contentModels[kind]
      .find(unscannedFilter)
      .select("_id title")
      .lean();
    console.info(`${kind}: ${rows.length} without a fingerprint`);
    for (const [i, row] of rows.entries()) {
      try {
        const result = await fingerprintContent(kind, row._id);
        console.info(`  ${i + 1}/${rows.length} ${result}: ${row.title}`);
      } catch (error: any) {
        console.warn(
          `  ${i + 1}/${rows.length} failed: ${row.title}: ${error?.message}`,
        );
      }
    }
  }
}

async function readAll(key: string) {
  const { body } = await storage.get(key);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
/** How the hash behaves on real re-renders: every stored processed version vs its original. */
async function selfCheck() {
  for (const kind of kinds) {
    const rows: any[] = await contentModels[kind]
      .find({
        deletedAt: null,
        "files.processed": { $ne: null },
        "fingerprint.v": { $exists: true },
      })
      .select("title fingerprint files.processed")
      .lean();
    console.info(`${kind}: ${rows.length} items with a processed version`);
    for (const row of rows) {
      const asset: any = await FileAsset.findById(row.files.processed).lean();
      if (!asset) continue;
      const processed = await computeFingerprint(await readAll(asset.key));
      const similarity = compareFingerprints(processed, row.fingerprint);
      console.info(
        `  ${Math.round(similarity.score * 100)}% (${similarity.basis}${similarity.matchedPages !== undefined ? `, ${similarity.matchedPages}/${processed.pages.filter(Boolean).length} pages` : ""}) ${row.title}`,
      );
    }
  }
}

/** The item worth keeping: published first, then the most used, then the oldest. */
function keeperOf(items: any[]) {
  return [...items].sort((a, b) => {
    const live = (i: any) => (i.status === "published" ? 1 : 0);
    const use = (i: any) => (i.downloads || 0) + (i.views || 0);
    return (
      live(b) - live(a) ||
      use(b) - use(a) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  })[0];
}

async function dedupe() {
  const { pairs, unscanned } = await duplicatePairs(0.5);
  console.info(
    `\nUnscanned: ${kinds.map((k) => `${k} ${unscanned[k]}`).join(", ")}`,
  );
  console.info(
    `\nPairs sharing at least 50% of their content: ${pairs.length}`,
  );
  for (const pair of pairs)
    console.info(
      `  ${pair.similarity}% (${pair.basis}) ${pair.kind}\n     A: ${label(pair.a)}\n     B: ${label(pair.b)}`,
    );
  // Identical items form groups (A=B and B=C make one group of three).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const items = new Map<string, any>();
  for (const pair of pairs) {
    if (pair.score < threshold) continue;
    for (const item of [pair.a, pair.b])
      items.set(`${pair.kind}:${item._id}`, { ...item, kind: pair.kind });
    const a = `${pair.kind}:${pair.a._id}`,
      b = `${pair.kind}:${pair.b._id}`;
    parent.set(find(a), find(b));
  }
  const groups = new Map<string, any[]>();
  for (const key of items.keys()) {
    const root = find(key);
    groups.set(root, [...(groups.get(root) || []), items.get(key)]);
  }
  console.info(
    `\nGroups of identical content (>= ${Math.round(threshold * 100)}%): ${groups.size}`,
  );
  let removed = 0;
  for (const group of groups.values()) {
    const keeper = keeperOf(group);
    console.info(`\n  KEEP   ${group[0].kind}: ${label(keeper)}`);
    for (const copy of group) {
      if (String(copy._id) === String(keeper._id)) continue;
      console.info(`  ${apply ? "DELETE" : "would delete"} ${label(copy)}`);
      if (!apply) continue;
      const model = contentModels[copy.kind as Kind];
      const full: any = await model.findById(copy._id).lean();
      await model.updateOne(
        { _id: keeper._id },
        {
          $addToSet: {
            offerings: {
              $each: (full.offerings || []).map((o: any) => o._id ?? o),
            },
          },
          $inc: { downloads: full.downloads || 0, views: full.views || 0 },
        },
      );
      await model.updateOne(
        { _id: copy._id },
        { $set: { deletedAt: new Date() } },
      );
      await ProcessingJob.deleteMany({ content: copy._id, status: "queued" });
      await AuditLog.create({
        action: "dedupe",
        target: `${copy.kind}/${copy._id}`,
        details: { keeper: String(keeper._id), title: copy.title },
      });
      removed++;
    }
  }
  console.info(
    apply
      ? `\nSoft-deleted ${removed} copies. Restore any from the admin list with "Include deleted".`
      : `\nDry run: nothing changed. Re-run with --apply to soft-delete the copies.`,
  );
}

await mongoose.connect(config.mongoUri);
try {
  if (!flag("--skip-backfill")) await backfill();
  if (flag("--self-check")) await selfCheck();
  await dedupe();
} finally {
  await mongoose.disconnect();
}
