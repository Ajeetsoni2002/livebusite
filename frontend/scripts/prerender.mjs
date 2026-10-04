import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  dist = resolve(root, "dist"),
  snapshot = JSON.parse(await readFile(resolve(dist, "snapshot.json"), "utf8"));
const template = await readFile(resolve(dist, "index.html"), "utf8"),
  site = (process.env.VITE_SITE_URL || "http://localhost:5173").replace(
    /\/$/,
    "",
  );
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pathFor = (p) => {
  const o = p.offerings[0];
  return o
    ? `/papers/${o.program.slug}/${o.branch.slug}/sem-${o.semester.number}/${o.subject.slug}/${p.year || "unknown"}/${p.slug}`
    : `/paper/${p.slug}`;
};
const cards = (items, notes = false) =>
  `<div class="content-grid">${items.map((p) => `<a class="resource card" href="${escape(notes ? `/notes/${p.slug}` : pathFor(p))}"><span class="eyebrow">${escape(p.offerings[0]?.subject.code)}</span><h3>${escape(p.title)}</h3><p>${escape(p.year || p.unit || "")} · ${escape(p.offerings[0]?.semester.name)}</p></a>`).join("")}</div>`;
const routes = new Map();
routes.set("/", {
  title: "BUIT Papers · Barkatullah University",
  description:
    "Barkatullah University previous year papers and subject notes, organized for students.",
  body: `<main class="page"><section class="hero"><div><div class="eyebrow">BARKATULLAH UNIVERSITY</div><h1>Less searching.<br/>More understanding.</h1><p>Your student-built library for BUIT.</p><a href="/papers" class="button">Browse question papers</a></div></section>${cards(snapshot.papers.slice(0, 6))}</main>`,
});
routes.set("/papers", {
  title: "Question papers · BUIT Papers",
  body: `<main class="page"><h1>Question papers</h1>${cards(snapshot.papers)}</main>`,
});
routes.set("/notes", {
  title: "Short notes · BUIT Papers",
  body: `<main class="page"><h1>Short notes</h1>${snapshot.notes.length ? cards(snapshot.notes, true) : "<p>No notes published yet. Request or contribute a resource.</p>"}</main>`,
});
routes.set("/about", {
  title: "Our story · Ajeet Kumar Soni · BUIT Papers",
  description:
    "Meet Ajeet Kumar Soni, creator of the unofficial BUIT student archive, and the community behind the papers and notes.",
  body: `<main class="page info-page"><div class="page-heading"><div class="eyebrow">BUIT / OUR STORY</div><h1>Built together. Passed forward.</h1></div><p>This unofficial resource was created by Ajeet Kumar Soni and team to help Barkatullah University students find previous year question papers.</p><section class="card prose"><h2>A little help for the next batch.</h2><p>A student archive organized by branch, semester and subject, grown through community contributions.</p><a class="creator-link" href="https://ajeet-portfolio-welcome10.vercel.app/" target="_blank" rel="noopener noreferrer">Ajeet Kumar Soni / Portfolio</a><p><a href="/contact">Contribute to the archive</a></p></section></main>`,
});
for (const offering of snapshot.offerings) {
  const subjectPath = `/subjects/${offering.program.slug}/${offering.branch.slug}/sem-${offering.semester.number}/${offering.subject.slug}`,
    papers = snapshot.papers.filter((p) =>
      p.offerings.some((o) => o._id === offering._id),
    ),
    notes = snapshot.notes.filter((p) =>
      p.offerings.some((o) => o._id === offering._id),
    );
  routes.set(subjectPath, {
    title: `${offering.subject.code} ${offering.subject.name} · BUIT Papers`,
    body: `<main class="page"><h1>${escape(offering.subject.name)}</h1><p>${escape(offering.subject.code)} · ${escape(offering.branch.name)} · ${escape(offering.semester.name)}</p><h2>Papers</h2>${cards(papers)}<h2>Notes</h2>${cards(notes, true)}</main>`,
  });
}
for (const [kind, items] of [
  ["papers", snapshot.papers],
  ["notes", snapshot.notes],
])
  for (const item of items) {
    const path = kind === "papers" ? pathFor(item) : `/notes/${item.slug}`;
    routes.set(path, {
      title: `${item.title}${item.year ? ` · ${item.year}` : ""} · BUIT Papers`,
      description: `${item.offerings[0]?.subject.name || item.title} ${kind === "papers" ? "question paper" : "short note"} for Barkatullah University.`,
      body: `<main class="page"><h1>${escape(item.title)}</h1><p>${escape(item.year || "")} ${escape(item.session || "")}</p><p>${escape(item.offerings[0]?.subject.name)}</p><p>Contributor: ${escape(item.credit || "Student archive")}</p><a href="/${kind}" class="button secondary">Browse ${kind}</a>${kind === "notes" && item.format === "markdown" ? `<pre>${escape(item.markdown)}</pre>` : ""}</main>`,
    });
  }
for (const [path, page] of routes) {
  const description =
    page.description ||
    "Barkatullah University question papers and notes. Unofficial student resource.";
  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(page.title)}</title>`)
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${escape(description)}"/>`,
    )
    .replace('<div id="root"></div>', `<div id="root">${page.body}</div>`)
    .replace(
      "</head>",
      `<link rel="canonical" href="${escape(site + path)}"/><meta property="og:title" content="${escape(page.title)}"/><meta property="og:description" content="${escape(description)}"/><meta property="og:url" content="${escape(site + path)}"/><meta property="og:type" content="website"/><meta property="og:image" content="${escape(site + "/branding/crest.png")}"/></head>`,
    );
  const file = resolve(dist, path.slice(1), "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
await writeFile(
  resolve(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...routes.keys()].map((path) => `<url><loc>${escape(site + path)}</loc><lastmod>${snapshot.generatedAt.slice(0, 10)}</lastmod></url>`).join("")}</urlset>`,
);
await writeFile(
  resolve(dist, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /contributor\nDisallow: /api\nSitemap: ${site}/sitemap.xml\n`,
);
console.info(
  `Prerendered ${routes.size} public pages and sitemap. Rebuild after snapshot updates.`,
);
