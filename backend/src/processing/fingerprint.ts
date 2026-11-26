import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { contentModels, FileAsset } from "../modules/models.js";
import { storage } from "../storage/index.js";
import {
  DUPLICATE_THRESHOLD,
  FINGERPRINT_VERSION,
  SIMILAR_THRESHOLD,
  buildFingerprint,
  commonShingles,
  comparePrepared,
  pairPrepared,
  prepare,
  markdownFingerprint,
  percent,
  type Boilerplate,
  type Fingerprint,
  type Similarity,
} from "../lib/fingerprint.js";

/** Header and instruction phrases shared across the library, left out of comparisons. */
const boilerplateOf = (rows: any[]): Boilerplate => ({
  text: commonShingles(rows.map((row) => row.fingerprint?.text)),
  ocr: commonShingles(rows.map((row) => row.fingerprint?.ocr)),
});

/*
 * Server side of duplicate detection: computes a content fingerprint of a stored PDF in
 * a child process (the API itself never renders pages) and compares fingerprints across
 * the library. The algorithm lives in lib/fingerprint.ts, shared with the browser.
 */
type Kind = "papers" | "notes";
const MAX_OUTPUT = 16 * 1024 * 1024;
// Run from source (tsx in dev and tests), the worker needs tsx too to import the shared module.
const fromSource = import.meta.url.endsWith(".ts");

export async function computeFingerprint(
  bytes: Buffer,
  {
    ocr = config.ocrOnServer,
    // OCR of a scan's first pages is the slow part, especially on a small instance.
    timeoutMs = ocr ? 900_000 : 300_000,
  }: { ocr?: boolean; timeoutMs?: number } = {},
): Promise<Fingerprint> {
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=320",
        ...(fromSource ? ["--import", "tsx"] : []),
        fileURLToPath(new URL("./fingerprint-worker.mjs", import.meta.url)),
        JSON.stringify({ ocr, ocrCacheDir: resolvePath(config.ocrCacheDir) }),
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const out: Buffer[] = [];
    let error = "",
      length = 0,
      finished = false;
    const finish = (fail?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdin.destroy();
      if (child.exitCode === null) child.kill();
      if (fail) reject(fail);
      else resolve(Buffer.concat(out).toString("utf8"));
    };
    const timer = setTimeout(
      () => finish(new Error("Fingerprinting timed out")),
      timeoutMs,
    );
    child.once("error", (e) => finish(e));
    child.stdin.on("error", () => {});
    child.stderr.on("data", (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(0, 300);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_OUTPUT)
        return finish(new Error("Fingerprint output too large"));
      out.push(chunk);
    });
    child.once("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(error || `Fingerprint worker exited with ${code}`),
      ),
    );
    child.stdin.end(bytes);
  });
  // Anything a library printed before the result is ignored.
  const result = JSON.parse(raw.slice(raw.lastIndexOf('{"pageCount"'))) as {
    pages: (number[] | null)[];
    text: string;
    ocr: string;
  };
  return buildFingerprint(result.pages, result.text, result.ocr);
}

async function readAll(key: string) {
  const { body } = await storage.get(key);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** The file a fingerprint describes: the uploaded original, never the watermarked copy. */
export const sourceAssetOf = (item: any) => item.files?.original ?? item.asset;

/** Live items whose fingerprint is missing or from an older algorithm. */
export const unscannedFilter = {
  deletedAt: null,
  $or: [
    { fingerprint: { $exists: false } },
    { "fingerprint.v": { $ne: FINGERPRINT_VERSION } },
  ],
};

/**
 * Computes and stores the fingerprint of one item from its source file. OCR text the
 * uploader's browser already read is kept (the file is the same), unless `reuseOcr` is
 * off; everything else is recomputed here.
 */
export async function fingerprintContent(
  kind: Kind,
  id: unknown,
  { reuseOcr = true }: { reuseOcr?: boolean } = {},
) {
  const model = contentModels[kind];
  const item: any = await model
    .findById(id)
    .select("asset files format markdown deletedAt fingerprint")
    .lean();
  if (!item || item.deletedAt) return "skipped";
  let fingerprint: Fingerprint;
  let source: unknown = null;
  if (item.format === "markdown")
    fingerprint = markdownFingerprint(item.markdown || "");
  else {
    source = sourceAssetOf(item);
    const asset: any = source && (await FileAsset.findById(source).lean());
    if (!asset || asset.deletedAt) return "skipped";
    const previous = item.fingerprint;
    const keptOcr =
      reuseOcr &&
      previous?.v === FINGERPRINT_VERSION &&
      String(previous.source ?? "") === String(source) &&
      previous.ocr?.sketch?.length
        ? previous.ocr
        : null;
    fingerprint = await computeFingerprint(await readAll(asset.key), {
      ocr: config.ocrOnServer && !keptOcr,
    });
    if (!fingerprint.text && !fingerprint.ocr && keptOcr)
      fingerprint.ocr = keptOcr;
  }
  invalidateDuplicateReport();
  await model.updateOne(
    { _id: id },
    {
      $set: {
        fingerprint: {
          ...fingerprint,
          source,
          by: "server",
          computedAt: new Date(),
        },
      },
    },
  );
  return "done";
}

export type DuplicateMatch = Similarity & {
  kind: Kind;
  similarity: number;
  item: any;
};
const matchFields =
  "title slug status year examType session unit topic format author offerings downloads views createdAt";
async function describe(kind: Kind, ids: unknown[]) {
  const rows: any[] = await contentModels[kind]
    .find({ _id: { $in: ids } })
    .select(matchFields)
    .populate("author", "name")
    .populate({
      path: "offerings",
      populate: ["subject", "branch", "semester", "program"],
    })
    .lean();
  return new Map(rows.map((row) => [String(row._id), row]));
}

/**
 * Library items of the same kind whose content overlaps the candidate's, best first.
 * Only items of the same kind count: a paper quoted in full inside long notes is not a
 * duplicate of those notes.
 */
export async function findDuplicates(
  kind: Kind,
  candidate: Fingerprint,
  {
    exclude,
    min = SIMILAR_THRESHOLD,
    limit = 5,
  }: { exclude?: unknown; min?: number; limit?: number } = {},
): Promise<DuplicateMatch[]> {
  const rows: any[] = await contentModels[kind]
    .find({
      deletedAt: null,
      "fingerprint.v": { $exists: true },
      ...(exclude ? { _id: { $ne: exclude } } : {}),
    })
    .select("fingerprint")
    .lean();
  const boilerplate = boilerplateOf(rows);
  const prepared = prepare(candidate, boilerplate);
  const scored = rows
    .map((row) => ({
      id: String(row._id),
      ...comparePrepared(prepared, prepare(row.fingerprint, boilerplate)),
    }))
    .filter((row) => row.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const items = await describe(
    kind,
    scored.map((s) => s.id),
  );
  return scored
    .filter((s) => items.has(s.id))
    .map(({ id, ...similarity }) => ({
      ...similarity,
      kind,
      similarity: percent(similarity.score),
      item: items.get(id),
    }));
}

/*
 * The pairwise report grows with the square of the library and the API runs on a very
 * small instance, so a computed report is reused for a while and dropped as soon as a
 * fingerprint changes or an item is deleted or restored.
 */
const REPORT_TTL_MS = 10 * 60_000;
let cachedReport: {
  min: number;
  at: number;
  value: Awaited<ReturnType<typeof computePairs>>;
} | null = null;
export function invalidateDuplicateReport() {
  cachedReport = null;
}
/** Every pair of live items of a kind that share at least `min` of their content. */
export async function duplicatePairs(min = DUPLICATE_THRESHOLD) {
  if (
    cachedReport &&
    cachedReport.min === min &&
    Date.now() - cachedReport.at < REPORT_TTL_MS
  )
    return cachedReport.value;
  const value = await computePairs(min);
  cachedReport = { min, at: Date.now(), value };
  return value;
}
async function computePairs(min: number) {
  const pairs: {
    kind: Kind;
    score: number;
    similarity: number;
    basis: Similarity["basis"];
    a: any;
    b: any;
  }[] = [];
  const unscanned: Record<string, number> = {};
  for (const kind of Object.keys(contentModels) as Kind[]) {
    const model = contentModels[kind];
    unscanned[kind] = await model.countDocuments(unscannedFilter);
    const rows: any[] = await model
      .find({ deletedAt: null, "fingerprint.v": { $exists: true } })
      .select("fingerprint")
      .lean();
    const found: { a: string; b: string; similarity: Similarity }[] = [];
    const boilerplate = boilerplateOf(rows);
    const prepared = rows.map((row) => prepare(row.fingerprint, boilerplate));
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const similarity = pairPrepared(prepared[i], prepared[j]);
        if (similarity.score >= min)
          found.push({
            a: String(rows[i]._id),
            b: String(rows[j]._id),
            similarity,
          });
      }
    if (!found.length) continue;
    const items = await describe(kind, [
      ...new Set(found.flatMap((f) => [f.a, f.b])),
    ]);
    for (const f of found)
      if (items.has(f.a) && items.has(f.b))
        pairs.push({
          kind,
          score: f.similarity.score,
          similarity: percent(f.similarity.score),
          basis: f.similarity.basis,
          a: items.get(f.a),
          b: items.get(f.b),
        });
  }
  pairs.sort((x, y) => y.score - x.score);
  return { pairs, unscanned };
}
