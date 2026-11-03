import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
/*
 * Writes a static HTML page for every public route so search engines (and slow phones)
 * get real titles, text, links and structured data before any JavaScript runs.
 * Keep titles in step with usePageMeta calls in src/: Google reads both.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  dist = resolve(root, "dist"),
  snapshot = JSON.parse(await readFile(resolve(dist, "snapshot.json"), "utf8"));
const template = await readFile(resolve(dist, "index.html"), "utf8");
if (!template.includes('<div id="root"></div>'))
  throw new Error(
    "dist/index.html is already prerendered; run vite build first.",
  );
const site = (process.env.VITE_SITE_URL || "http://localhost:5173").replace(
  /\/$/,
  "",
);
const SITE_NAME = "BUIT Papers",
  UNIVERSITY = "Barkatullah University",
  INSTITUTE = "Barkatullah University Institute of Technology (BUIT), Bhopal";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
const fullTitle = (title) =>
  title.includes(SITE_NAME) ? title : `${title} · ${SITE_NAME}`;
const day = (value) => String(value || snapshot.generatedAt).slice(0, 10);

const programOf = new Map(snapshot.programs.map((p) => [p._id, p]));
const branchPath = (b) =>
  `/programs/${programOf.get(b.program)?.slug || "btech"}/${b.slug}`;
const subjectPath = (o) =>
  `/subjects/${o.program.slug}/${o.branch.slug}/sem-${o.semester.number}/${o.subject.slug}`;
const pathFor = (p) => {
  const o = p.offerings[0];
  return o
    ? `/papers/${o.program.slug}/${o.branch.slug}/sem-${o.semester.number}/${o.subject.slug}/${p.year || "unknown"}/${p.slug}`
    : `/paper/${p.slug}`;
};
const paperName = (p, notes = false) => {
  const o = p.offerings[0];
  return o
    ? `${o.subject.name} (${o.subject.code})${p.year ? ` ${p.year}` : ""} ${notes ? "short notes" : "question paper"}`
    : p.title;
};
const cards = (items, notes = false) =>
  `<div class="content-grid">${items.map((p) => `<a class="resource card" href="${escape(notes ? `/notes/${p.slug}` : pathFor(p))}"><span class="eyebrow">${escape(p.offerings[0]?.subject.code)}</span><h3>${escape(paperName(p, notes))}</h3><p>${escape([p.examType !== "Unknown" && p.examType, p.offerings[0]?.branch.code, p.offerings[0]?.semester.name].filter(Boolean).join(" · "))}</p></a>`).join("")}</div>`;
const breadcrumbs = (trail) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map(([name, path], i) => ({
    "@type": "ListItem",
    position: i + 1,
    name,
    item: site + path,
  })),
});
const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${site}/#organization`,
  name: SITE_NAME,
  url: `${site}/`,
  logo: `${site}/branding/crest.png`,
  description: `Free, student-built archive of ${UNIVERSITY} previous year question papers and notes.`,
  sameAs: ["https://github.com/Ajeetsoni2002/livebusite"],
};

/* Offerings grouped by branch and semester, for link hubs. */
const byBranch = new Map();
for (const o of snapshot.offerings) {
  const papers = snapshot.papers.filter((p) =>
    p.offerings.some((x) => x._id === o._id),
  ).length;
  const entry = byBranch.get(o.branch._id) || {
    branch: o.branch,
    sems: new Map(),
  };
  const sem = entry.sems.get(o.semester.number) || [];
  sem.push({ offering: o, papers });
  entry.sems.set(o.semester.number, sem);
  byBranch.set(o.branch._id, entry);
}
const branchHub = (entry) =>
  [...entry.sems.entries()]
    .sort(([a], [b]) => a - b)
    .map(
      ([n, list]) =>
        `<h3>Semester ${n}</h3><ul>${list
          .sort((a, b) =>
            a.offering.subject.code.localeCompare(b.offering.subject.code),
          )
          .map(
            ({ offering: o, papers }) =>
              `<li><a href="${escape(subjectPath(o))}">${escape(o.subject.code)} ${escape(o.subject.name)} question papers</a>${papers ? ` (${papers})` : ""}</li>`,
          )
          .join("")}</ul>`,
    )
    .join("");
const branchLinks = `<ul class="branch-links">${[...byBranch.values()]
  .map(({ branch: b }) => b)
  .sort((a, z) => (a.order ?? 0) - (z.order ?? 0))
  .map(
    (b) =>
      `<li><a href="${escape(branchPath(b))}">${escape(b.name)}${b.code ? ` (${escape(b.code)})` : ""} previous year papers</a></li>`,
  )
  .join("")}</ul>`;

/** path → { title, description, body, schema[], priority, changefreq, lastmod } */
const routes = new Map();
routes.set("/", {
  title: `${SITE_NAME} – ${UNIVERSITY} Previous Year Question Papers & Notes`,
  description: `Free ${UNIVERSITY} (BU Bhopal) BUIT previous year question papers for B.Tech CSE, IT, EC, EE, ME and Civil – every semester and subject, plus short notes. View online or download PDFs.`,
  priority: "1.0",
  changefreq: "daily",
  schema: [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${site}/#website`,
      name: SITE_NAME,
      alternateName: [
        "BUIT Papers Bhopal",
        "Barkatullah University question papers",
      ],
      url: `${site}/`,
      inLanguage: "en-IN",
      publisher: { "@id": `${site}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${site}/papers?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    organization,
  ],
  body: `<main class="page"><section class="hero"><div><div class="eyebrow">BARKATULLAH UNIVERSITY · BHOPAL</div><h1>${UNIVERSITY} previous year question papers</h1><p>BUIT B.Tech question papers and short notes, organized by branch, semester and subject. Free to view and download.</p><a href="/papers" class="button">Browse question papers</a></div></section><section><h2>Papers by branch</h2>${branchLinks}</section><section><h2>Recently added papers</h2>${cards(snapshot.papers.slice(0, 9))}</section><section><h2>Jobs &amp; internships</h2><p><a href="/jobs">Latest jobs and internships for BUIT students</a></p></section></main>`,
});
routes.set("/papers", {
  title: `${UNIVERSITY} Previous Year Question Papers (BUIT B.Tech)`,
  description: `All ${UNIVERSITY} BUIT B.Tech previous year question papers in one place – search by subject name or paper code, filter by branch, semester and year. Free PDF download.`,
  priority: "0.9",
  changefreq: "daily",
  schema: [
    breadcrumbs([
      ["Home", "/"],
      ["Question papers", "/papers"],
    ]),
  ],
  body: `<main class="page"><h1>${UNIVERSITY} previous year question papers</h1><p>Every BUIT paper we have, newest first. Pick your branch to see papers semester by semester.</p>${branchLinks}${cards(snapshot.papers)}</main>`,
});
routes.set("/notes", {
  title: `Short notes for ${UNIVERSITY} (BUIT) subjects`,
  description: `Short notes for ${UNIVERSITY} BUIT B.Tech subjects, shared by students. Quick revision before exams.`,
  priority: "0.7",
  changefreq: "weekly",
  schema: [
    breadcrumbs([
      ["Home", "/"],
      ["Short notes", "/notes"],
    ]),
  ],
  body: `<main class="page"><h1>Short notes for BUIT subjects</h1>${snapshot.notes.length ? cards(snapshot.notes, true) : "<p>No notes published yet. Request or contribute a resource.</p>"}</main>`,
});
routes.set("/jobs", {
  title: "Jobs & internships for BUIT students",
  description: `Latest jobs and internships for ${UNIVERSITY} (BUIT Bhopal) students. Read the details and apply online in a minute.`,
  priority: "0.8",
  changefreq: "daily",
  schema: [
    breadcrumbs([
      ["Home", "/"],
      ["Jobs & internships", "/jobs"],
    ]),
  ],
  body: `<main class="page jobs-page"><div class="page-heading"><div class="eyebrow">BUIT / CAREERS</div><h1>Jobs &amp; internships.</h1><p>Openings shared for BUIT and ${UNIVERSITY} students. Read the details and apply with a short form.</p></div></main>`,
});
routes.set("/contributors", {
  title: "Top contributors",
  description: `The students who shared ${UNIVERSITY} papers and notes with the next batch.`,
  priority: "0.5",
  changefreq: "weekly",
  body: `<main class="page community-page"><div class="page-heading"><div class="eyebrow">BUIT / COMMUNITY</div><h1>The people behind the papers.</h1><p>Every paper and note here was shared by a student who wanted the next batch to have it easier.</p></div><p><a href="/contribute">Become a contributor</a></p></main>`,
});
routes.set("/contribute", {
  title: "Become a contributor – earn for every paper",
  description: `Have ${UNIVERSITY} question papers or notes? Create a free contributor account, upload them and earn for every approved upload.`,
  priority: "0.6",
  changefreq: "monthly",
  body: `<main class="page info-page"><div class="page-heading"><div class="eyebrow">BUIT / CONTRIBUTE</div><h1>Have papers? Share them.</h1><p>Create a contributor account in a minute and upload question papers and notes. An admin checks each upload before it goes live.</p><p><a href="/contributor/login">Contributor login</a></p></div></main>`,
});
routes.set("/about", {
  title: "Our story · Ajeet Kumar Soni",
  description:
    "Meet Ajeet Kumar Soni, creator of the unofficial BUIT student archive, and the community behind the papers and notes.",
  priority: "0.4",
  changefreq: "yearly",
  body: `<main class="page info-page"><div class="page-heading"><div class="eyebrow">BUIT / OUR STORY</div><h1>Built together. Passed forward.</h1></div><p>This unofficial resource was created by Ajeet Kumar Soni and team to help ${UNIVERSITY} students find previous year question papers.</p><section class="card prose"><h2>A little help for the next batch.</h2><p>A student archive organized by branch, semester and subject, grown through community contributions.</p><a class="creator-link" href="https://ajeet-portfolio-welcome10.vercel.app/" target="_blank" rel="noopener noreferrer">Ajeet Kumar Soni / Portfolio</a><p><a href="/contribute">Contribute to the archive</a></p></section></main>`,
});
for (const entry of byBranch.values()) {
  const b = entry.branch,
    path = branchPath(b),
    label = `${b.name}${b.code ? ` (${b.code})` : ""}`;
  routes.set(path, {
    title: `${label} previous year question papers – BUIT Bhopal`,
    description: `All ${b.name} previous year question papers of ${UNIVERSITY} (BUIT Bhopal), semester-wise and subject-wise. Free PDF download.`,
    priority: "0.8",
    changefreq: "weekly",
    schema: [
      breadcrumbs([
        ["Home", "/"],
        ["Question papers", "/papers"],
        [label, path],
      ]),
    ],
    body: `<main class="page"><h1>${escape(label)} previous year question papers</h1><p>${escape(b.name)} papers from ${INSTITUTE}, arranged by semester. Open a subject to see every year we have.</p>${branchHub(entry)}</main>`,
  });
}
for (const offering of snapshot.offerings) {
  const path = subjectPath(offering),
    { subject: s, branch: b, semester: sem } = offering,
    papers = snapshot.papers.filter((p) =>
      p.offerings.some((o) => o._id === offering._id),
    ),
    notes = snapshot.notes.filter((p) =>
      p.offerings.some((o) => o._id === offering._id),
    ),
    years = [...new Set(papers.map((p) => p.year).filter(Boolean))].sort(
      (a, z) => z - a,
    );
  routes.set(path, {
    title: `${s.name} (${s.code}) previous year question papers – ${b.code || b.name} ${sem.name}`,
    description: `Download ${s.name} (${s.code}) previous year question papers${years.length ? ` (${years.join(", ")})` : ""} for ${b.name}, ${sem.name} – ${INSTITUTE}. Free PDFs, sorted by year.`,
    priority: "0.8",
    changefreq: "weekly",
    lastmod: papers[0]?.updatedAt,
    schema: [
      breadcrumbs([
        ["Home", "/"],
        [b.name, branchPath(b)],
        [`${s.code} ${s.name}`, path],
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `${s.name} (${s.code}) question papers`,
        url: site + path,
        isPartOf: { "@id": `${site}/#website` },
        about: { "@type": "Thing", name: s.name },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: papers.length,
          itemListElement: papers.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: site + pathFor(p),
            name: paperName(p),
          })),
        },
      },
    ],
    body: `<main class="page"><nav class="breadcrumbs"><a href="/">Home</a> / <a href="${escape(branchPath(b))}">${escape(b.name)}</a></nav><h1>${escape(s.name)} (${escape(s.code)}) previous year question papers</h1><p>${escape(s.code)} · ${escape(b.name)} · ${escape(sem.name)} · ${UNIVERSITY}, Bhopal${years.length ? `. Years available: ${years.join(", ")}` : ""}.</p><h2>Question papers</h2>${papers.length ? cards(papers) : "<p>No papers for this subject yet.</p>"}${notes.length ? `<h2>Short notes</h2>${cards(notes, true)}` : ""}</main>`,
  });
}
for (const [kind, items] of [
  ["papers", snapshot.papers],
  ["notes", snapshot.notes],
])
  for (const item of items) {
    const notes = kind === "notes",
      path = notes ? `/notes/${item.slug}` : pathFor(item),
      o = item.offerings[0],
      name = paperName(item, notes),
      exam =
        item.examType && item.examType !== "Unknown" ? `${item.examType} ` : "";
    routes.set(path, {
      title: o
        ? `${name} – ${o.branch.code || o.branch.name} ${o.semester.name}`
        : name,
      description: o
        ? `${notes ? "Short notes" : exam ? `${exam}question paper` : "Question paper"} of ${o.subject.name} (${o.subject.code})${item.year ? ` ${item.year}` : ""} for ${o.branch.name}, ${o.semester.name} – ${INSTITUTE}. View online or download the PDF free.`
        : `${name} for ${UNIVERSITY}.`,
      priority: "0.7",
      changefreq: "monthly",
      lastmod: item.updatedAt,
      schema: o
        ? [
            breadcrumbs([
              ["Home", "/"],
              [o.branch.name, branchPath(o.branch)],
              [`${o.subject.code} ${o.subject.name}`, subjectPath(o)],
              [name, path],
            ]),
            {
              "@context": "https://schema.org",
              "@type": "LearningResource",
              name,
              url: site + path,
              learningResourceType: notes ? "Lecture notes" : "Exam paper",
              educationalLevel: "Undergraduate (B.Tech)",
              inLanguage: "en-IN",
              isAccessibleForFree: true,
              ...(item.year ? { temporalCoverage: String(item.year) } : {}),
              ...(item.thumbKey
                ? { thumbnailUrl: `${site}/files/${item.thumbKey}` }
                : {}),
              about: { "@type": "Thing", name: o.subject.name },
              educationalAlignment: {
                "@type": "AlignmentObject",
                alignmentType: "educationalSubject",
                targetName: `${o.subject.code} ${o.subject.name}`,
              },
              provider: {
                "@type": "CollegeOrUniversity",
                name: "Barkatullah University Institute of Technology",
                address: {
                  "@type": "PostalAddress",
                  addressLocality: "Bhopal",
                  addressRegion: "Madhya Pradesh",
                  addressCountry: "IN",
                },
              },
              publisher: { "@id": `${site}/#organization` },
            },
          ]
        : [],
      body: `<main class="page">${o ? `<nav class="breadcrumbs"><a href="/">Home</a> / <a href="${escape(branchPath(o.branch))}">${escape(o.branch.name)}</a> / <a href="${escape(subjectPath(o))}">${escape(o.subject.code)} ${escape(o.subject.name)}</a></nav>` : ""}<h1>${escape(name)}</h1><p>${escape([exam.trim(), item.year, item.session, o?.branch.name, o?.semester.name].filter(Boolean).join(" · "))}</p><p>${escape(UNIVERSITY)}, Bhopal · ${escape(o?.subject.name || "")}</p><p>Contributor: ${escape(item.credit || "Student archive")}</p>${o ? `<a href="${escape(subjectPath(o))}" class="button secondary">All ${escape(o.subject.code)} papers</a>` : `<a href="/${kind}" class="button secondary">Browse ${kind}</a>`}${notes && item.format === "markdown" ? `<pre>${escape(item.markdown)}</pre>` : ""}</main>`,
    });
  }

const verification = [
  ["google-site-verification", process.env.VITE_GOOGLE_SITE_VERIFICATION],
  ["msvalidate.01", process.env.VITE_BING_SITE_VERIFICATION],
]
  .filter(([, value]) => value)
  .map(([name, value]) => `<meta name="${name}" content="${escape(value)}"/>`)
  .join("");
for (const [path, page] of routes) {
  const title = fullTitle(page.title),
    description = page.description,
    url = site + path;
  const head = [
    // dist/index.html doubles as the SPA fallback for routes that are not prerendered
    // (e.g. /jobs/:slug), so the home page leaves its canonical to usePageMeta.
    path === "/" ? "" : `<link rel="canonical" href="${escape(url)}"/>`,
    `<meta name="robots" content="index, follow, max-image-preview:large"/>`,
    `<meta property="og:site_name" content="${SITE_NAME}"/>`,
    `<meta property="og:locale" content="en_IN"/>`,
    `<meta property="og:type" content="${path === "/" ? "website" : "article"}"/>`,
    `<meta property="og:title" content="${escape(title)}"/>`,
    `<meta property="og:description" content="${escape(description)}"/>`,
    `<meta property="og:url" content="${escape(url)}"/>`,
    `<meta property="og:image" content="${escape(site + "/branding/crest.png")}"/>`,
    `<meta name="twitter:card" content="summary"/>`,
    `<meta name="twitter:title" content="${escape(title)}"/>`,
    `<meta name="twitter:description" content="${escape(description)}"/>`,
    path === "/" ? verification : "",
    ...(page.schema || []).map(jsonLd),
  ].join("");
  const html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/,
      `<meta name="description" content="${escape(description)}"/>`,
    )
    .replace('<div id="root"></div>', `<div id="root">${page.body}</div>`)
    .replace("</head>", `${head}</head>`);
  const file = resolve(dist, path.slice(1), "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
await writeFile(
  resolve(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
    ...routes,
  ]
    .map(
      ([path, page]) =>
        `<url><loc>${escape(site + path)}</loc><lastmod>${day(page.lastmod)}</lastmod><changefreq>${page.changefreq || "monthly"}</changefreq><priority>${page.priority || "0.5"}</priority></url>`,
    )
    .join("\n")}\n</urlset>\n`,
);
await writeFile(
  resolve(dist, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /contributor$\nDisallow: /contributor/\nAllow: /contributor/login\nDisallow: /api\nDisallow: /forgot-password\nDisallow: /reset-password\nDisallow: /verify-email\n\nSitemap: ${site}/sitemap.xml\n`,
);
console.info(
  `Prerendered ${routes.size} public pages and sitemap. Rebuild after snapshot updates.`,
);
