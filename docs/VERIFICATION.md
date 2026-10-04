# Verification record — 2026-10-04

Environment: Windows, Node 22.14, installed Chrome, local MongoDB replica set.
These are local results. Deployed R2/Atlas/Render/Vercel acceptance requires the owner
environment and launch checks in README.

| Check | Result |
|---|---|
| npm test | 29 backend + 4 frontend URL/snapshot tests; zero failures. Disposable real replica sets. |
| npm run lint | ESLint and TypeScript pass for both apps. |
| npm run build | Both apps build; 93 public pages, sitemap/robots, optimized branding/legacy mapping. |
| npm run smoke | Eight endpoint checks pass, including readiness, catalogs, unauthorized access and invalid paging. |
| npm run test:browser | Passes on both dev 5173 and built preview 4173: keyboard/focus, pagination, guards, forced change, shared notes, approval, safe rendering, staff pages, mobile fallback/recovery, PDF and old links. |
| npm run test:thumbnails | Dev and built-preview checks pass: credentialed images, lazy previews, real related-paper cards, mobile layout, icon fallback and API outage. Built images load directly from API origin 4000 while the frontend uses 4173. |
| Thumbnail backfill | 77 generated, zero failures/skips; repeat generated zero. Originals unchanged. |
| Snapshot export/build/package | 52 published papers, zero notes; validation, 93 HTML pages and .vercel/output packaging pass. Strict public fields, consistent totals and atomic failure preservation covered by tests. |
| Prepared artifact | Verified 52 public thumbnail flags, all 93 HTML routes, clean URL overrides, static routing guards, legacy redirect, absence of environment/backend files, and rendering through the compiled production worker. |
| npm audit --omit=dev | Zero reported vulnerabilities. |
| npm audit | Zero reported vulnerabilities. |
| Repeated migration | 140 original paths; 77 assets/papers; 38 subjects/offerings; six branches; eight semesters. 52 published / 25 pending. |
| Mobile Lighthouse | Three final preview runs on 4173: median performance **95**, range **84–96**; accessibility, best practices and SEO **100** in all runs. [All measurements](lighthouse-mobile.json). |

Lighthouse used simulated mobile conditions and a live local API. This is not a
guarantee for public network latency, hosting cold starts, CPU contention, or every
page. The initial run scored 86. A later repeat varied between 87 and 94. Animation
now loads only when search opens, reducing the first compressed JavaScript chunk
from about 131 KB to 117 KB. The final runs scored 96, 84, 95; another browser
verification ran concurrently, so these local measurements include machine-load
variation. Confirm the target on production and representative phones before launch.

## Coverage and remaining acceptance checks

Auth covers CSRF, no registration, forced change, rotation/replay, logout, immediate
deactivation, roles/reset. Upload tests exercise MIME, magic bytes and parser checks,
ownership and moderation. Full PDF reads and ranges are verified. Notes/taxonomy
cover publication, restore, duplicate offering merges and partial metadata preservation.
Analytics covers deduplication, DNT/bot/staff exclusions, daily rotation/redaction and
note download labels/totals. Frontend tests verify signed URL handling, real subject
search/year suggestions from snapshots, and related-resource array contracts.
Thumbnail tests verify page-one pixels, permission checks, takedown visibility,
no download counts, renderer failure/timeouts and successful PDF storage when
thumbnail storage fails. Export tests verify publication/deletion filters,
private-field exclusion, explicit output paths, and preservation of previous
snapshots after invalid fields/status/totals. The related-paper API regression
test verifies populated offering details and exclusion of staff-only fields.

Browser fixtures are removed after execution. Test PDFs are never seeded as public
archive entries. Screenshots are in ignored .npm-cache. Original files have no tracked
modifications. No production services or real accounts were created.

Before launch: set the real contact email, private bucket/Atlas credentials, stable
secrets, exact CORS origins and HTTPS sibling domains; verify proxy/header settings;
import bytes into production storage; create the real admin; export the production
snapshot/redeploy. Review 25 pending metadata conflicts. Run published-URL cookie,
download, cache, sitemap and performance checks. Enable scheduled snapshots and
optional publication using [the owner setup](SNAPSHOTS-AND-THUMBNAILS.md). The
GitHub workflow and external Vercel publication were prepared but not activated;
they require owner credentials. The earlier Lighthouse measurements predate
thumbnails; production performance needs a fresh check after hosting setup.
