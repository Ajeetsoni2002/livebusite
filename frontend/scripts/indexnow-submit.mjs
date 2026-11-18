/*
 * Submits pages to IndexNow (one request reaches Bing, Yandex, Seznam, Naver and others).
 * Run by .github/workflows/indexnow.yml after deploys; needs no packages.
 *
 *   SITE_URL   the live site, e.g. https://livebusite.pages.dev
 *   MODE       "recent" (default): submit the pages the latest build marked as new or
 *              changed, if that build finished within WINDOW_MINUTES.
 *              "all": submit every page in the sitemap (for the first run, or after a
 *              domain change).
 */
const site = (process.env.SITE_URL || "https://livebusite.pages.dev").replace(
  /\/$/,
  "",
);
const mode = process.env.MODE === "all" ? "all" : "recent";
const windowMinutes = Number(process.env.WINDOW_MINUTES || 90);

const get = async (path) => {
  const response = await fetch(`${site}${path}`, {
    headers: { "user-agent": "buit-indexnow" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
};

const build = await (await get("/indexnow.json")).json();
let urls;
if (mode === "all") {
  urls = (await (await get("/sitemap.txt")).text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
} else {
  const age = (Date.now() - Date.parse(build.builtAt)) / 60_000;
  if (!(age <= windowMinutes)) {
    console.info(
      `Latest build is ${Math.round(age)} minutes old; nothing new to submit.`,
    );
    process.exit(0);
  }
  urls = build.urls || [];
}
if (!urls.length) {
  console.info("No new or changed pages.");
  process.exit(0);
}
// The key file must answer on the site before the search engines accept the list.
const keyText = (await (await get(`/${build.key}.txt`)).text()).trim();
if (keyText !== build.key)
  throw new Error("The IndexNow key file does not match.");

const host = new URL(urls[0]).host;
const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host,
    key: build.key,
    keyLocation: `https://${host}/${build.key}.txt`,
    urlList: urls.filter((url) => new URL(url).host === host).slice(0, 10_000),
  }),
  signal: AbortSignal.timeout(30_000),
});
// 200 = accepted, 202 = accepted and the key is still being checked.
if (response.status !== 200 && response.status !== 202)
  throw new Error(
    `IndexNow answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
  );
console.info(
  `Submitted ${urls.length} page(s) to IndexNow (HTTP ${response.status}).`,
);
