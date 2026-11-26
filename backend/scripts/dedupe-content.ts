import mongoose from "mongoose";
import { config } from "../src/config.js";
import { contentModels, FileAsset } from "../src/modules/models.js";
import {
  computeFingerprint,
  duplicatePairs,
  fingerprintContent,
  unscannedFilter,
} from "../src/processing/fingerprint.js";
import { compareFingerprints } from "../src/lib/fingerprint.js";
import { storage } from "../src/storage/index.js";

/*
 * Fingerprints every paper and note that has no fingerprint yet and prints the pairs
 * whose content overlaps. It never deletes anything: the same pairs appear on the
 * admin Duplicates page with their match percentage, where the owner decides.
 *
 *   npx tsx scripts/dedupe-content.ts
 *   --min 0.5          lowest share of shared content to list (default 0.5)
 *   --skip-backfill    do not compute missing fingerprints first
 *   --self-check       also compare each original with its processed version
 *
 * The backfill reads source PDFs from storage, so point STORAGE_DRIVER and the S3
 * settings at the live bucket (see backend/.env.production).
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const min = Number(option("--min", "0.5"));
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

async function report() {
  const { pairs, unscanned } = await duplicatePairs(min);
  console.info(
    `\nUnscanned: ${kinds.map((k) => `${k} ${unscanned[k]}`).join(", ")}`,
  );
  console.info(
    `\nPairs sharing at least ${Math.round(min * 100)}% of their content: ${pairs.length}`,
  );
  for (const pair of pairs)
    console.info(
      `  ${pair.similarity}% (${pair.basis}) ${pair.kind}\n     A: ${label(pair.a)}\n     B: ${label(pair.b)}`,
    );
  console.info(
    "\nNothing was changed. Review these pairs on the admin Duplicates page.",
  );
}

await mongoose.connect(config.mongoUri);
try {
  if (!flag("--skip-backfill")) await backfill();
  if (flag("--self-check")) await selfCheck();
  await report();
} finally {
  await mongoose.disconnect();
}
