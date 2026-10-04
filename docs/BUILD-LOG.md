# Build ledger

Approved plan: [2026-10-03-mern-platform.md](superpowers/plans/2026-10-03-mern-platform.md).
Implemented inline in the existing workspace. Original static sources remain unchanged.

| Step | Changed files | Verification / how to check |
|---|---|---|
| 1. Foundations | Root packages, frontend Vite/Tailwind, backend config, env examples | Build/lint pass; unsafe production config rejected. |
| 2. Startup | Backend app/server/http helpers | Ping, readiness, errors; DB before listen; graceful shutdown. |
| 3. Models | Backend models | Model/index tests; shared offerings, publication, hashes and TTL. |
| 4. Migration | Inventory/import/snapshot scripts, migration manifest | 140 paths → 77 binaries; 38 subjects. Seed twice: 77 assets/papers, 52 published, 25 pending. |
| 5. Authentication | Auth/password helpers, create-admin, staff Auth UI | CSRF, guards, forced change, refresh replay, logout, deactivation/reset tests. Bcrypt cost 12; 72-byte limit. |
| 6. Storage/upload | Storage adapters, file/content routes | MIME/magic/parser checks, traversal, full reads, ranges, signed access and download idempotency. |
| 7. Public API | Catalog routes | Published-only facets/search, bounded paging, input validation, reports/requests and smoke. |
| 8. Public UI | Catalog features, components, Layout/styles | Desktop/mobile screenshots; keyboard search, pagination, no overflow, real PDF preview. |
| 9. Notes | Note model/contracts, Upload/Browse/Detail | PDF/Markdown, moderation, credit, tags, unit/topic, shared offerings; unsafe rendering excluded. |
| 10. Staff workflows | Admin/content routes, staff features | Ownership/moderation, restore, taxonomy merge, parent validation and password reset tests; browser upload → edit → approve. |
| 11. Analytics | Analytics routes/client queue/admin charts | Daily rotation, redaction, dedup, DNT/bot/staff exclusions and note reporting. Reviewer verified 12 concurrent events, one unique visitor. |
| 12. Resilience/SEO | Public reads/queries/meta, snapshot/build scripts, Legacy routes | Outage → live recovery; 93 public HTML pages; 143 legacy mappings; original portfolio. |
| 13. Release | Scripts, hosting config, README/troubleshooting | Tests/build/lint/smoke/browser checks, clean dependency audits and mobile Lighthouse. See verification record. |

Run npm test, npm run lint, npm run build, npm run smoke and npm run test:browser.
Detailed results: [VERIFICATION.md](VERIFICATION.md).

## Review and fixes

A fresh reviewer reproduced Zod 4 defaults resetting omitted PATCH fields.
parsePatch now assigns supplied keys; regression tests first failed, then passed.
Signed S3 URLs remain unchanged, covered by URL tests. Edit forms retain every shared
offering. Snapshot regression tests verify subject/year search and related arrays.
Note downloads resolve titles and count both resource types; DNT/bots/staff
produce no download analytics. Browser checks corrected labels and keyboard focus.
Animation moved into the lazy search palette. Final mobile performance median is
95 across three runs (84–96); other Lighthouse category scores are 100.

## Workspace decisions

- Git metadata is read-only; branch creation was denied. No commits or git metadata changes.
- npm uses a workspace cache. This Windows harness needs ComSpec for lifecycle scripts.
- In-app Browser had no available browser; standalone Playwright used installed Chrome.
- Persistent local MongoDB replica set uses port 27018 and checks the port first.
- Browser fixture accounts/notes are local-only and removed in finally.
- Lighthouse was used then removed from dependencies due transitive tool advisories.
  Current full and production dependency audits report zero vulnerabilities.
- No external hosting, messaging, paid subscription or real staff account was provisioned.

## Follow-up: snapshots and thumbnails — 2026-10-04

Implemented the approved bounded follow-up. The exporter now uses positive public
field projections, validates published state/totals, supports an explicit output
path, and replaces snapshots atomically. Read-only CI exports disable collection
and index creation. The six-hour workflow is disabled until configured, creates
a Vercel prebuilt artifact, and has optional credential-gated publication.

PDF.js renders page-one WebP thumbnails in a bounded child process. Private
storage and existing document visibility checks protect images. Uploads retain
their PDFs on rendering/storage failures; backfill is resumable. Cards and details
lazy-load previews and retain an icon on failure. All 77 archived files generated
thumbnails; a repeated run generated zero. Source PDFs remain untouched.

The independent reviewer reproduced a related-paper card crash and staff-field
exposure in the edited catalog path. A failing regression test preceded the fix:
related queries now populate all offering relationships and exclude private
fields. The reviewer confirmed both fixes against the running API.

Verification: 29 backend + 4 frontend tests pass, lint/build pass, public snapshot
export/validation/package pass, full dependency audit reports zero vulnerabilities,
API smoke and full browser checks pass. Thumbnail browser checks exercise direct
API-origin images, related cards, mobile layout, lazy loading and outage fallback.
Setup and operational limits: [SNAPSHOTS-AND-THUMBNAILS.md](SNAPSHOTS-AND-THUMBNAILS.md).
No scheduled job or production deployment was activated in this workspace.
