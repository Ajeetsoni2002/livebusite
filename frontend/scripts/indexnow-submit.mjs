/*
 * Submits pages to IndexNow (one request reaches Bing, Yandex, Seznam, Naver and others).
 * Run by .github/workflows/indexnow.yml after deploys; needs no packages.
 *
 *   SITE_URL   the live site, e.g. https://livebusite.pages.dev
 *   MODE       "recent" (default): submit the pages the latest build marked as new or
 *              changed, if that build finished within WINDOW_MINUTES.
 *              "all": submit every page in the sitemap (for the first run, or after a
 *              domain change).
 *              "test": submit only the home page, to check the setup.
 *
 * On failure the reason is printed as a GitHub annotation, so it shows on the run's
 * summary page without opening the log.
 */
const site = (process.env.SITE_URL || "https://livebusite.pages.dev").replace(
  /\/$/,
  "",
);
const mode = ["all", "test"].includes(process.env.MODE)
  ? process.env.MODE
  : "recent";
const windowMinutes = Number(process.env.WINDOW_MINUTES || 90);
/** A short, readable excerpt of a response body (HTML tags removed). */
const excerpt = async (response) =>
  (await response.text())
    .replace(/<(script|style)[\s\S]*?<\/>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "(no details)";
const userAgent = `Mozilla/5.0 (compatible; BUIT-IndexNow/1.0; +${site}/)`;

/** fetch with three attempts for network errors, 429 and 5xx answers. */
async function request(url, options = {}) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { "user-agent": userAgent, ...options.headers },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status !== 429 && response.status < 500) return response;
      last = new Error(
        `${url} answered HTTP ${response.status}: ${await excerpt(response)}`,
      );
    } catch (error) {
      last = new Error(`${url} could not be reached: ${error.message}`);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5_000));
  }
  throw last;
}
async function get(path) {
  const response = await request(`${site}${path}`);
  if (!response.ok)
    throw new Error(
      `${site}${path} answered HTTP ${response.status}: ${await excerpt(response)}`,
    );
  return response;
}

async function main() {
  const build = await (await get("/indexnow.json")).json();
  let urls;
  if (mode === "all")
    urls = (await (await get("/sitemap.txt")).text())
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  else if (mode === "test") urls = [`${site}/`];
  else {
    const age = (Date.now() - Date.parse(build.builtAt)) / 60_000;
    if (!(age <= windowMinutes))
      return console.info(
        `Latest build is ${Math.round(age)} minutes old; nothing new to submit.`,
      );
    urls = build.urls || [];
  }
  if (!urls.length) return console.info("No new or changed pages.");
  // The key file must answer on the site before the search engines accept the list.
  const keyText = (await (await get(`/${build.key}.txt`)).text()).trim();
  if (keyText !== build.key)
    throw new Error(`${site}/${build.key}.txt does not contain the key.`);

  const host = new URL(urls[0]).host;
  const list = urls
    .filter((url) => new URL(url).host === host)
    .slice(0, 10_000);
  const response = await request("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host,
      key: build.key,
      keyLocation: `https://${host}/${build.key}.txt`,
      urlList: list,
    }),
  });
  // 200 = accepted, 202 = accepted while the key is still being checked.
  if (response.status !== 200 && response.status !== 202)
    throw new Error(
      `IndexNow answered HTTP ${response.status}: ${await excerpt(response)}`,
    );
  console.info(
    `Submitted ${list.length} page(s) to IndexNow (HTTP ${response.status}).`,
  );
}

try {
  await main();
} catch (error) {
  const message = String(error?.message || error).replace(/[\r\n]+/g, " ");
  console.error(`::error title=IndexNow submission failed::${message}`);
  process.exitCode = 1;
}
