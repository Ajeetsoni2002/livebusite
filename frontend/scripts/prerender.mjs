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
/* Open jobs come straight from the live API; a build without it just lists none. */
const jobsApi = (
  process.env.SNAPSHOT_API_URL ||
  (site.startsWith("https://") ? `${site}/api` : "")
).replace(/\/$/, "");
async function liveJobs() {
  if (!jobsApi || process.env.SNAPSHOT_FETCH === "off") return [];
  try {
    const list = await fetch(`${jobsApi}/jobs`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!list.ok) return [];
    const jobs = [];
    for (const job of (await list.json()).data) {
      const detail = await fetch(
        `${jobsApi}/jobs/${encodeURIComponent(job.slug)}`,
        {
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (detail.ok) jobs.push((await detail.json()).data);
    }
    return jobs;
  } catch {
    return [];
  }
}
const jobs = await liveJobs();
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
/*
 * Pages are written as <path>/index.html, which Cloudflare serves at <path>/ and
 * redirects <path> to. Canonicals, the sitemap and links therefore use the slash form,
 * so search engines are pointed straight at the address that answers 200.
 */
const slashed = (path) =>
  path === "/" || path.endsWith("/") ? path : `${path}/`;
const pageUrl = (path) => site + slashed(path);
/** Adds the trailing slash to internal page links in prerendered markup. */
const slashLinks = (html) =>
  html.replace(/href="(\/[^"?#.]*[^/"?#.])"/g, (_, path) => `href="${path}/"`);

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
    item: pageUrl(path),
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

const itemsFor = (offering, items) =>
  items.filter((p) => p.offerings.some((o) => o._id === offering._id));
/*
 * Only subjects with at least one paper or note get a page: empty listings are thin
 * pages that search engines hold against a site.
 */
const offerings = snapshot.offerings.filter(
  (o) =>
    itemsFor(o, snapshot.papers).length || itemsFor(o, snapshot.notes).length,
);
/* Offerings grouped by branch and semester, for link hubs. */
const byBranch = new Map();
for (const o of offerings) {
  const papers = itemsFor(o, snapshot.papers).length,
    notes = itemsFor(o, snapshot.notes).length;
  const entry = byBranch.get(o.branch._id) || {
    branch: o.branch,
    sems: new Map(),
  };
  const sem = entry.sems.get(o.semester.number) || [];
  sem.push({ offering: o, papers, notes });
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
            ({ offering: o, papers, notes }) =>
              `<li><a href="${escape(subjectPath(o))}">${escape(o.subject.code)} ${escape(o.subject.name)} ${papers ? "question papers" : "notes"}</a> (${[papers && `${papers} paper${papers > 1 ? "s" : ""}`, notes && `${notes} note${notes > 1 ? "s" : ""}`].filter(Boolean).join(", ")})</li>`,
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

/* Answers to what students search for; the same text is shown on the live home page. */
const homeFaq = [
  [
    "Where can I find Barkatullah University previous year question papers?",
    `BUIT Papers collects ${UNIVERSITY} (BU Bhopal) B.Tech previous year question papers for every branch – CSE, IT, EC, EX, ME and Civil – sorted by semester, subject and year. Search by subject name or paper code, for example CSE-501 or BE-102.`,
  ],
  [
    "Are the papers free to download?",
    "Yes. Every paper and note can be viewed online or downloaded as a PDF for free, without signing up.",
  ],
  [
    "Are first-year (semester 1 and 2) papers included?",
    "Yes. First-year BE papers such as Engineering Mathematics, Chemistry, Physics and Basic Electrical Engineering are common to all branches and appear under every branch.",
  ],
  [
    "Is this the official Barkatullah University website?",
    "No. BUIT Papers is an unofficial archive made by students of BUIT, Bhopal. Papers are shared by students and checked by an admin before they go live.",
  ],
  [
    "Can I share my old papers or notes?",
    "Yes. Create a contributor account, upload clear photos or scans, and earn for every paper or note that is approved.",
  ],
];
const homeFaqHtml = `<section class="eh-faq"><h2>Questions students ask</h2>${homeFaq.map(([q, a]) => `<details><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`).join("")}</section>`;

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
  body: `<main class="page"><section class="hero"><div><div class="eyebrow">BARKATULLAH UNIVERSITY · BHOPAL</div><h1>${UNIVERSITY} (BU Bhopal) previous year question papers</h1><p>${snapshot.papers.length} BUIT B.Tech question papers and ${snapshot.notes.length} short notes, organized by branch, semester and subject. Free to view and download.</p><a href="/papers" class="button">Browse question papers</a> <a href="/notes" class="button secondary">Short notes</a></div></section><section><h2>Papers by branch</h2>${branchLinks}</section><section><h2>Recently added papers</h2>${cards(snapshot.papers.slice(0, 9))}</section>${snapshot.notes.length ? `<section><h2>Recently added notes</h2>${cards(snapshot.notes.slice(0, 6), true)}</section>` : ""}<section><h2>Jobs &amp; internships</h2><p><a href="/jobs">Latest jobs and internships for BUIT students</a></p></section>${homeFaqHtml}</main>`,
});
for (const [page, title, description, heading, text] of [
  [
    "privacy",
    "Privacy",
    "How BUIT Papers handles visitor and contributor data.",
    "A library that respects your privacy.",
    "We count visits without tracking people, and use contributor emails only for sign-in and password resets.",
  ],
  [
    "copyright",
    "Copyright & takedown",
    "How to report a paper or note that should not be on BUIT Papers.",
    "Copyright &amp; takedown",
    "If you own material on this site and want it removed, contact us and we will take it down.",
  ],
  [
    "contact",
    "Contact & request a paper",
    `Request a missing ${UNIVERSITY} question paper, report a problem or contact the BUIT Papers team.`,
    "Help us fill the gaps.",
    "Request a missing paper, flag a problem, or ask the team about the archive.",
  ],
])
  routes.set(`/${page}`, {
    title,
    description,
    priority: "0.3",
    changefreq: "yearly",
    body: `<main class="page info-page"><div class="page-heading"><div class="eyebrow">BUIT / ${escape(title.toUpperCase())}</div><h1>${heading}</h1></div><p>${escape(text)}</p></main>`,
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
  body: `<main class="page jobs-page"><div class="page-heading"><div class="eyebrow">BUIT / CAREERS</div><h1>Jobs &amp; internships.</h1><p>Openings shared for BUIT and ${UNIVERSITY} students. Read the details and apply with a short form.</p></div>${jobs.length ? `<ul>${jobs.map((j) => `<li><a href="/jobs/${escape(j.slug)}">${escape(j.title)} – ${escape(j.company)}</a> (${j.kind === "job" ? "Job" : "Internship"}${j.location ? `, ${escape(j.location)}` : ""})</li>`).join("")}</ul>` : "<p>No openings right now. Check back soon.</p>"}</main>`,
});
for (const job of jobs) {
  const kind = job.kind === "job" ? "Job" : "Internship",
    path = `/jobs/${job.slug}`;
  routes.set(path, {
    title: `${job.title} at ${job.company} (${kind})`,
    description: `${kind} at ${job.company}${job.location ? ` in ${job.location}` : ""}${job.pay ? `, ${job.pay}` : ""}. For BUIT and ${UNIVERSITY} students – read the details and apply online.`,
    priority: "0.6",
    changefreq: "daily",
    lastmod: job.updatedAt,
    schema: [
      breadcrumbs([
        ["Home", "/"],
        ["Jobs & internships", "/jobs"],
        [job.title, path],
      ]),
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: job.title,
        description: job.description,
        datePosted: job.createdAt,
        ...(job.deadline ? { validThrough: job.deadline } : {}),
        employmentType: job.kind === "internship" ? "INTERN" : "FULL_TIME",
        hiringOrganization: { "@type": "Organization", name: job.company },
        ...(job.mode === "remote"
          ? {
              jobLocationType: "TELECOMMUTE",
              applicantLocationRequirements: {
                "@type": "Country",
                name: "India",
              },
            }
          : {
              jobLocation: {
                "@type": "Place",
                address: {
                  "@type": "PostalAddress",
                  addressLocality: job.location || "Bhopal",
                  addressRegion: "Madhya Pradesh",
                  addressCountry: "IN",
                },
              },
            }),
      },
    ],
    body: `<main class="page job-detail"><a href="/jobs">All jobs &amp; internships</a><h1>${escape(job.title)}</h1><p>${escape(job.company)} · ${kind}${job.location ? ` · ${escape(job.location)}` : ""}${job.pay ? ` · ${escape(job.pay)}` : ""}</p>${job.eligibility ? `<p>${escape(job.eligibility)}</p>` : ""}<div class="job-description">${escape(job.description)}</div></main>`,
  });
}
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
for (const offering of offerings) {
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
  const what = papers.length ? "previous year question papers" : "short notes";
  routes.set(path, {
    title: `${s.name} (${s.code}) ${what} – ${b.code || b.name} ${sem.name}`,
    description: papers.length
      ? `Download ${s.name} (${s.code}) previous year question papers${years.length ? ` (${years.join(", ")})` : ""}${notes.length ? " and short notes" : ""} for ${b.name}, ${sem.name} – ${INSTITUTE}. Free PDFs, sorted by year.`
      : `${s.name} (${s.code}) short notes for ${b.name}, ${sem.name} – ${INSTITUTE}. Free PDF for quick revision.`,
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
        url: pageUrl(path),
        isPartOf: { "@id": `${site}/#website` },
        about: { "@type": "Thing", name: s.name },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: papers.length,
          itemListElement: papers.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: pageUrl(pathFor(p)),
            name: paperName(p),
          })),
        },
      },
    ],
    body: `<main class="page"><nav class="breadcrumbs"><a href="/">Home</a> / <a href="${escape(branchPath(b))}">${escape(b.name)}</a></nav><h1>${escape(s.name)} (${escape(s.code)}) ${what}</h1><p>${escape(s.code)} · ${escape(b.name)} · ${escape(sem.name)} · ${UNIVERSITY}, Bhopal${years.length ? `. Years available: ${years.join(", ")}` : ""}.</p>${papers.length ? `<h2>Question papers</h2>${cards(papers)}` : ""}${notes.length ? `<h2>Short notes</h2>${cards(notes, true)}` : ""}</main>`,
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
              url: pageUrl(path),
              learningResourceType: notes ? "Lecture notes" : "Exam paper",
              educationalLevel: "Undergraduate (B.Tech)",
              inLanguage: "en-IN",
              isAccessibleForFree: true,
              ...(item.year ? { temporalCoverage: String(item.year) } : {}),
              ...(item.hasThumbnail
                ? { thumbnailUrl: `${site}/api/${kind}/${item._id}/thumbnail` }
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
/** Fills the built index.html with one page's head and static body. */
function render(path, page, { noindex = false } = {}) {
  const title = fullTitle(page.title),
    description = page.description,
    url = pageUrl(path);
  const head = [
    noindex ? "" : `<link rel="canonical" href="${escape(url)}"/>`,
    `<meta name="robots" content="${noindex ? "noindex, follow" : "index, follow, max-image-preview:large"}"/>`,
    `<meta property="og:site_name" content="${SITE_NAME}"/>`,
    `<meta property="og:locale" content="en_IN"/>`,
    `<meta property="og:type" content="${path === "/" ? "website" : "article"}"/>`,
    `<meta property="og:title" content="${escape(title)}"/>`,
    `<meta property="og:description" content="${escape(description)}"/>`,
    noindex ? "" : `<meta property="og:url" content="${escape(url)}"/>`,
    `<meta property="og:image" content="${site}/branding/og.png"/>`,
    `<meta property="og:image:width" content="1200"/>`,
    `<meta property="og:image:height" content="630"/>`,
    `<meta property="og:image:alt" content="BUIT Papers – Barkatullah University previous year question papers"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${escape(title)}"/>`,
    `<meta name="twitter:description" content="${escape(description)}"/>`,
    `<meta name="twitter:image" content="${site}/branding/og.png"/>`,
    path === "/" ? verification : "",
    ...(page.schema || []).map(jsonLd),
  ].join("");
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/,
      `<meta name="description" content="${escape(description)}"/>`,
    )
    .replace(
      '<div id="root"></div>',
      `<div id="root">${slashLinks(page.body)}</div>`,
    )
    .replace("</head>", `${head}</head>`);
}
async function write(path, html) {
  const file =
    path === "/404"
      ? resolve(dist, "404.html")
      : resolve(dist, path.slice(1), "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
for (const [path, page] of routes) await write(path, render(path, page));

// App screens that are not for search results but must still answer 200 (the app takes
// over in the browser). Not listed in the sitemap.
for (const [path, title] of [
  ["/contributor/login", "Contributor login"],
  ["/admin/login", "Admin login"],
  ["/forgot-password", "Forgot password"],
  ["/reset-password", "Choose a new password"],
  ["/verify-email", "Confirm your email"],
])
  await write(
    path,
    render(
      path,
      {
        title,
        description: `${title} – ${SITE_NAME}.`,
        body: `<main class="page" role="status">Opening ${escape(title.toLowerCase())}…</main>`,
      },
      { noindex: true },
    ),
  );
/*
 * A top-level 404.html makes Cloudflare answer unknown addresses with 404 instead of the
 * home page (a "soft 404"). It is still the app shell, so app-only routes such as the
 * admin workspace or a paper added since the last build open normally in the browser.
 */
await write(
  "/404",
  render(
    "/404",
    {
      title: "Page not found",
      description: `This page is not on ${SITE_NAME}. Browse ${UNIVERSITY} question papers instead.`,
      body: `<main class="page"><h1>Page not found</h1><p>This address is not part of the library. <a href="/papers">Browse question papers</a> or <a href="/notes">short notes</a>.</p></main>`,
    },
    { noindex: true },
  ),
);

/*
 * Links from the old static site (PDF file names, old pages) get permanent redirects to
 * their new pages, so the reputation those links built carries over.
 */
const legacy = JSON.parse(
  await readFile(resolve(dist, "legacy-map.json"), "utf8"),
);
const ownRedirects = await readFile(resolve(dist, "_redirects"), "utf8").catch(
  () => "",
);
const legacyRules = Object.entries(legacy)
  .map(([from, to]) => {
    const target = to.includes("?") ? to : slashed(to);
    return `${encodeURI(from)} ${target} 301`;
  })
  .filter((rule) => rule.length <= 1000);
await writeFile(
  resolve(dist, "_redirects"),
  `${ownRedirects.trim()}\n# Old static-site links\n${legacyRules.join("\n")}\n`,
);

await writeFile(
  resolve(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...routes]
  .map(
    ([path, page]) =>
      `<url><loc>${escape(pageUrl(path))}</loc><lastmod>${day(page.lastmod)}</lastmod><changefreq>${page.changefreq || "monthly"}</changefreq><priority>${page.priority || "0.5"}</priority></url>`,
  )
  .join("\n")}\n</urlset>\n`,
);
await writeFile(
  resolve(dist, "robots.txt"),
  `User-agent: *
Allow: /
Disallow: /admin
Disallow: /contributor$
Disallow: /contributor/
Allow: /contributor/login
Disallow: /api
Disallow: /forgot-password
Disallow: /reset-password
Disallow: /verify-email

Sitemap: ${site}/sitemap.xml
`,
);
console.info(
  `Prerendered ${routes.size} public pages (${snapshot.papers.length} papers, ${snapshot.notes.length} notes, ${offerings.length} subjects, ${jobs.length} jobs), 404 page, ${legacyRules.length} legacy redirects and sitemap.`,
);
