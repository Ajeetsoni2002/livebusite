# BUIT Papers

React/Vite + Express + MongoDB application for Barkatullah University question
papers and subject notes. The original static website and PDFs remain in place.
This is an unofficial student resource created by [Ajeet Kumar Soni](https://ajeet-portfolio-welcome10.vercel.app/) and team.

Hindi/Hinglish launch instructions: [step-by-step deployment guide](docs/DEPLOYMENT-HI.md).

Cloudflare Pages without a custom domain: [same-origin API proxy setup](docs/PAGES-API-PROXY-HI.md). The root `functions/api/[[path]].ts` forwards `/api/*` to the configured `API_ORIGIN`; the frontend must build with `VITE_API_BASE_URL=/api`.

## Local setup

Requires Node 22.14+ (or supported Node 24), npm, and a MongoDB replica set.
Transactions provide atomic download/analytics/taxonomy merges; refresh rotation
uses an atomic compare-and-update.

```powershell
npm ci
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm run db:dev
```

Keep the DB terminal open. This optional helper downloads MongoDB on first run
and keeps development data in `.npm-cache/dev-mongodb`. It uses port **27018**,
checks that the port is free, and does not reconfigure an existing MongoDB service.
Alternatively, set `MONGODB_URI` to your own replica set or Atlas test database.

In another terminal:

```powershell
npm run import:dry
npm run seed -w backend
npm run snapshot -w backend
npm run dev
```

Frontend: http://localhost:5173. API: http://localhost:4000/api.
Each app also supports `npm run dev` from its own directory.
The frontend dev proxy uses `/api`; production uses `VITE_API_BASE_URL`.
If this restricted Windows harness lacks ComSpec, set it in the current terminal:
`$env:ComSpec = 'C:\Windows\System32\cmd.exe'`.

## Create administrator

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12–128 characters) and `ADMIN_NAME` in
`backend/.env`, then run `npm run create-admin -w backend`.
Open `/admin/login`; the first login requires a new password. The script refuses
to overwrite an existing account. Remove `ADMIN_PASSWORD` from the environment
after creation. There are no default accounts and no public registration.

Admin creates contributors with temporary passwords. Share those passwords
securely; do not email them through this application. Contributors must change
their password and uploads require moderation unless admin enables trust.

## Import and metadata review

The inventory contains **140 source paths**, **77 unique PDF binaries**, **38
named CSE subjects**, and six existing branch names. Two 63-file folders are
exact duplicate copies. Initial import publishes 52 source-consistent records;
25 records stay pending because source subjects/years conflict or are missing.
Exam types remain explicitly `Unknown` when the source does not establish them.
Filename session ranges are preserved without claiming a month/date.

`migration/manifest.json` preserves paths, hashes, labels and conflicts.
The dry run writes this report without connecting to MongoDB. Repeated imports
use source hashes and set-on-insert to preserve staff edits/moderation decisions.
Mongoose names the Paper collection `paper` (its default pluralization).
Review the PDF and provenance in Admin → Moderation → Edit/inspect before approving.
No papers are created for empty links. The two Data science files and ambiguous
shared-branch files remain staged; their classification requires verification.

## Environment

See both `.env.example` files for every setting. Important backend settings:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB replica-set/Atlas connection URI |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Independent secrets, at least 32 characters |
| `ANALYTICS_SECRET` | Independent daily visitor/audit hashing secret |
| `CORS_ORIGINS` | Comma-separated exact frontend origins, no wildcard/trailing slash |
| `SITE_URL`, `API_URL` | Canonical frontend and API origins |
| `STORAGE_DRIVER` | `local` in development; `s3` required in production |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB` | Development upload path and per-PDF limit (default 20 MB) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | R2/S3-compatible endpoint, region and private bucket |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Bucket-scoped object credentials |
| `TRUST_PROXY` | Verified proxy hop count or trusted IP/subnet list; never blindly enable all |
| `ATLAS_SEARCH_ENABLED` | Enable the configured `subject_autocomplete` search index |
| `CF_ORIGIN_SECRET` | Verify Cloudflare request headers before trusting country information |
| `CONTACT_EMAIL` | Real copyright/takedown address; required in production |

Development generates process-local secrets if omitted; sessions then expire on
API restart. Configure stable random secrets in your `.env` for persistent logins.
Never use VITE-prefixed variables for secrets. Frontend receives only API URL,
canonical site URL and the public contact address.

## Verification

```powershell
npm test
npm run lint
npm run build
npm run smoke
```

API tests use disposable MongoDB replica sets and generated test PDFs, never fake
public catalog data. Smoke checks require the API and DB to be running.
The browser smoke test is limited to a local development DB and cleans its fixture
accounts/notes; run `npm run test:browser` after starting both apps.
Set `CHROME_PATH` if Chrome is installed elsewhere. The default is Windows Chrome.
For the built UI, start `npm run preview -w frontend` and set `BROWSER_BASE_URL` to
`http://127.0.0.1:4173`. Avoid backend edits during checks: development restarts
regenerate secrets and invalidate sessions. Results: [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Production: Atlas + R2 + Render + Vercel + Cloudflare

1. **Atlas:** create the database, a least-privilege application DB user, and network
   access restricted to the backend’s outbound addresses. Use its TLS connection
   URI in Render. Test against a separate DB. Configure backup/restore appropriate
   to your Atlas tier; test restoration before launch.
2. **R2:** create a **private** bucket; disable public `r2.dev` access. Create an
   object read/write token scoped to that bucket. Set endpoint
   `https://<account-id>.r2.cloudflarestorage.com`, region `auto`, bucket and access
   credentials. Configure bucket CORS for the exact frontend origins, GET/HEAD,
   Range requests and exposed Content-Length/Content-Range/Accept-Ranges headers.
   Signed URLs expire after 120 seconds and use the R2 S3 endpoint.
3. **Render:** use `render.yaml` or a Node Web Service. Repository root is the
   project root. Build `npm ci --include=dev && npm run build -w backend`; start
   `npm run start -w backend`; health path `/api/health`. Select an always-on
   instance; free instances still sleep. Set production variables from the table.
   Set Node 22.14+ or Node 24. Configure an HTTPS API domain under the same
   registrable domain as the frontend, such as `api.<your-domain>`.
4. **Import production data:** run the seed/admin scripts with the production
   environment from an authorized terminal. Storage must be `s3` for this import.
   Do not copy development filesystem keys into the production DB: source files
   must actually be uploaded into the production bucket. Verify 77 assets and
   pending/public counts, and preview/download representative papers.
5. **Vercel:** root directory `frontend`; install dependencies including workspace
   packages; build `npm run build`; output `dist`. Set `VITE_API_BASE_URL` to
   `https://api.<your-domain>/api`, `VITE_SITE_URL` to your canonical frontend
   origin and `VITE_CONTACT_EMAIL` to the real contact. Include all www/staging
   origins in backend CORS explicitly; arbitrary preview origins are not allowed.
6. **Cookies:** direct frontend/API requests require the same registrable domain
   so Secure, httpOnly, SameSite=Lax cookies work. Provider subdomains are separate
   sites. For Cloudflare Pages without a custom domain, use the implemented
   [same-origin API proxy](docs/PAGES-API-PROXY-HI.md) and test staff authentication
   after deploying its Function and runtime binding.
7. **Cloudflare:** SSL/TLS → Overview → **Full (strict)**; keep valid origin TLS.
   Cache Rules → API hostname or `/api/*` → **Bypass cache**. Remove browser/JS
   challenges from API requests using a narrow API rule; keep application rate
   limits. Do not weaken site-wide security. Verify proxy hops before setting
   `TRUST_PROXY`; test forwarded-IP spoofing on the origin. If country analytics
   is enabled, inject `X-Origin-Verify` with `CF_ORIGIN_SECRET` through a trusted
   request-header rule and strip untrusted incoming copies. Otherwise country
   stays `Unknown`; direct Render headers are not blindly trusted.
8. **Search:** optionally create the Atlas Search `subject_autocomplete` index on
   Subjects: static mappings for `name` as autocomplete, `code` as string, and
   `active` as boolean. Enable the env flag. Ordinary bounded search remains the
   fallback; it has less typo tolerance.
9. **Snapshots/SEO:** run `npm run snapshot -w backend` against the production DB,
   then rebuild/redeploy the frontend. Snapshot contains only published content,
   no storage URLs or private records. The prepared six-hour CI export/build and
   optional Vercel publication are described in [snapshot setup](docs/SNAPSHOTS-AND-THUMBNAILS.md).
   Configure its read-only DB credential and enable the workflow after a manual run. New content
   is immediately available through the live API, but static metadata/sitemap
   update on the next build. After takedown, regenerate immediately and purge
   snapshots/HTML caches. Old signed file links live at most 120 seconds.
10. **Launch:** configure contact details, review pending imports, verify staff
    password changes and roles, inspect browser cookies/CORS, run smoke tests,
    check sitemap/canonicals and measure mobile Lighthouse on the production URL.

No external service, domain, deployment or paid subscription was created by this
implementation. Actual dashboard configuration and credentials remain owner steps.

## Upload processing: watermark, clean-up and page split

The free Render instance (0.1 CPU, sleeps when idle) cannot do image work, so the
pipeline is split:

| Where | What |
| --- | --- |
| Browser (`frontend/src/lib/processing`) | Page classification, two-page spread detection and split, phone-photo clean-up, deskew, PDF assembly (pdf.js + pdf-lib, lazy-loaded) |
| API job queue (`backend/src/processing`) | Watermark on every page (pdf-lib in a child process), cover thumbnails |

**Versions are never overwritten.** Each paper/note keeps `files.original` (the
upload), an optional `files.processed`, cached watermarked copies and
`activeVersion`. `asset` is always the watermarked file the public receives, so
preview, download, counters and analytics are unchanged. Originals are only
readable by the owner and admins (`GET /api/{admin|contributor}/{kind}/:id/source/:version`).

**Flow.** A single PDF upload opens the Process Studio first: original vs
processed slider, zoom, per-page split (auto/on/off and position), clean-up
(auto/on/off), rotate, remove and reorder, global style (grayscale, black & white,
colour). Nothing is sent until “Upload processed version” or “Upload original
file”. Both choices are watermarked. New uploads stay off public routes
(`409 PREPARING`) until their watermarked copy exists. Admins (and owners while
an item is editable) can run **Process & preview**, revert/use processed,
re-apply the watermark, or bulk **Process** / **Watermark** from the tables.

**Settings → Watermark** (admin): template (only `{subjectCode}` of the first
subject is substituted; default `{subjectCode} | Ajeet Soni`), opacity, angle,
size, tiling, footer line, and “skip PDFs that already contain” (default
`Ajeet Soni`). Saving bumps a revision; “Apply watermark to all outdated items”
does a dry-run count, then re-marks items in the background while each keeps
serving its previous copy. “Find and rebuild missing covers” repairs thumbnails
whose storage objects are missing.

**Existing data.** No migration is required: the job treats an item without
`files` as having its current asset as the original. `npm run files:migrate -w
backend` (dry run; `-- --apply` to write) records originals explicitly. Then use
Settings → Apply watermark.

**Previews without the API (optional, recommended).** In Cloudflare → Workers &
Pages → the Pages project → Settings → Bindings → add an **R2 bucket** binding
named `FILES` → bucket `buitpapers`, then redeploy. `/files/*` (Pages Function)
then serves public watermarked PDFs and covers straight from R2 with immutable
caching; originals are never served (only objects stored with public metadata or
under `thumbnails/`). Without the binding the route returns 404 and the app uses
the API. The PDF viewer never embeds API pages in an iframe; the Pages proxy turns
any HTML answer from a sleeping API into JSON `503 WAKING_UP`, and the viewer
retries behind its own loading state.

**Checks.** `node --import tsx --test frontend/tests/processing.test.ts`
(synthetic fixtures), `node --import tsx scripts/process-samples.mts samples/*.pdf`
(before/after images in `docs/processing`), `node scripts/process-studio.mjs a.pdf
b.pdf` and `node scripts/preview-wakeup.mjs` (frontend dev server; API simulated).
Backend tests in `backend/tests/processing.test.ts` cover holding, every-page
watermark text, skip, settings permissions, re-apply, versions and thumbnails.

**Limits.** Detection is heuristic: a spread needs an empty, full-height gutter
near the middle (fold lines are tolerated; ruled tables and text crossing the
middle are not split); 45–70% confidence is flagged for manual review. Clean-up
crops dark surroundings and corrects skew up to ±4° but does not undo strong
perspective (a sheet photographed at a steep angle). Pages with real text are
treated as digital and never re-rendered; scanned PDFs with an OCR layer are
therefore not cleaned. Browser processing handles up to 60 pages; larger PDFs
should be uploaded as original. The watermark font is Helvetica, so templates are
limited to printable ASCII. PDFs are not linearised.

## Operational limits

Snapshots allow browsing during outages; downloads, authentication and submissions
still need the API. Signed URLs can be shared during their validity period and do
not prove completed downloads. Bot filtering and daily unique hashing are estimates.
First-page PDF thumbnails are generated on upload and can be backfilled with
`npm run thumbnails:backfill`. Rendering failures keep the PDF available and show
the document icon; full previews are lazy-loaded. See [limits and setup](docs/SNAPSHOTS-AND-THUMBNAILS.md).
The existing historical payment offer is preserved in source, but the new UI does
not promise payments without owner confirmation. No email invitation service is
configured; temporary-password onboarding is implemented.

Original PDF URLs open their current resource pages using generated
`frontend/public/legacy-map.json`; ambiguous imports lead to search until reviewed.
The original portfolio is copied to `/legacy/portfolio/` at build time. Keep original
archive directories in the repository: build preparation reads those sources.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) and [docs/BUILD-LOG.md](docs/BUILD-LOG.md).
