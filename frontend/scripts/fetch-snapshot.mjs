import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
/*
 * Refreshes public/snapshot.json from the live public API before each build, so the
 * prerendered pages and the sitemap list every published paper and note, not only the
 * ones in the committed snapshot. The committed file stays as the fallback: if the API
 * is asleep or unreachable the build carries on with it.
 *
 * Source: SNAPSHOT_API_URL, else `${VITE_SITE_URL}/api` (the live site's API proxy).
 * Set SNAPSHOT_FETCH=off to always use the committed file.
 */
const pub = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const site = (process.env.VITE_SITE_URL || "").replace(/\/$/, "");
const api = (
  process.env.SNAPSHOT_API_URL ||
  (site.startsWith("https://") ? `${site}/api` : "")
).replace(/\/$/, "");

const entityKeys = [
  "_id",
  "name",
  "slug",
  "code",
  "number",
  "program",
  "university",
  "order",
  "active",
  "aliases",
  "scheme",
  "semester",
  "notice",
  "verified",
  "originalLabel",
];
const contentKeys = [
  "_id",
  "title",
  "slug",
  "year",
  "session",
  "examType",
  "scheme",
  "credit",
  "tags",
  "featured",
  "format",
  "markdown",
  "unit",
  "topic",
  "status",
  "publishedAt",
  "createdAt",
  "updatedAt",
  "downloads",
  "views",
  "hasThumbnail",
];
const pick = (object, keys) =>
  Object.fromEntries(
    keys.filter((k) => object?.[k] != null).map((k) => [k, object[k]]),
  );
const entity = (e) => pick(e, entityKeys);
const complete = (o) => o?.subject && o?.branch && o?.semester && o?.program;
const offering = (o) => ({
  _id: o._id,
  subject: entity(o.subject),
  branch: entity(o.branch),
  semester: entity(o.semester),
  program: entity(o.program),
  ...(o.scheme ? { scheme: o.scheme } : {}),
});
const content = (item) => ({
  ...pick(item, contentKeys),
  offerings: (item.offerings || []).filter(complete).map(offering),
});

/** GET `data` with retries: the free API may take a minute to wake up. */
async function get(path) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(api + path, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return await response.json();
      lastError = new Error(`${path}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw lastError;
}
async function all(kind) {
  const items = [];
  for (let page = 1; page <= 200; page++) {
    const body = await get(`/${kind}?limit=50&page=${page}&sort=newest`);
    items.push(...body.data);
    if (page >= (body.meta?.pages || 1)) break;
  }
  return items;
}

async function build() {
  const list = async (name) => (await get(`/${name}`)).data.map(entity);
  const [universities, programs, branches, semesters, subjects] =
    await Promise.all(
      ["universities", "programs", "branches", "semesters", "subjects"].map(
        list,
      ),
    );
  const offerings = (await get("/offerings")).data
    .filter(complete)
    .map(offering);
  const papers = (await all("papers")).map(content);
  const notes = (await all("notes")).map(content);
  if (!papers.length) throw new Error("the API returned no papers");
  return {
    generatedAt: new Date().toISOString(),
    source: "published-database",
    universities,
    programs,
    branches,
    semesters,
    subjects,
    offerings,
    papers,
    notes,
    stats: {
      papers: papers.length,
      notes: notes.length,
      downloads: [...papers, ...notes].reduce(
        (n, i) => n + (i.downloads || 0),
        0,
      ),
    },
  };
}

const file = resolve(pub, "snapshot.json");
if (!api || process.env.SNAPSHOT_FETCH === "off") {
  console.info("Snapshot: using the committed file (no live API configured).");
} else {
  try {
    const fresh = await build();
    const old = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify(fresh));
    console.info(
      `Snapshot refreshed from ${api}: ${fresh.papers.length} papers, ${fresh.notes.length} notes (was ${old.papers.length}/${old.notes.length}).`,
    );
  } catch (error) {
    console.warn(
      `Snapshot refresh skipped (${error?.message || error}); using the committed file.`,
    );
  }
}
