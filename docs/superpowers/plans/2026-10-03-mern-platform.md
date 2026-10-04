# BUIT MERN Platform Implementation Plan

> For agentic workers: use superpowers:executing-plans task by task.

**Goal:** Upgrade the existing static BUIT library into the approved MERN platform.
**Architecture:** Separate frontend/backend beside preserved legacy files. Domain
modules own validation, persistence and HTTP contracts; object storage is an adapter.
**Tech Stack:** React, Vite, TypeScript, Tailwind, Query, Express, MongoDB, R2.
**Spec:** ../specs/2026-10-03-mern-platform-design.md

## Global constraints
- Preserve original files; no invented published papers or subjects.
- No public registration; bcrypt cost >=12; secure cookie auth with rotation.
- No raw visitor IP storage; DNT/bots/staff exclusion; Asia/Kolkata days.
- Production files must use object storage; never commit secrets.
- User authorized continuous inline execution after each verified step.

## Review focus
- Conflicting HTML labels must not overwrite provenance or silently publish.
- Concurrent refresh/replay and immediate deactivation must invalidate access.
- Contributor IDs and update payloads must not bypass ownership or moderation.
- PDF preview range requests must not increment downloads or expose pending files.
- Duplicate/retried analytics and unavailable APIs must not inflate counters or hang UI.

## Tasks
Each task follows test first for behavioral code, observes failure, implements,
runs its verification and records evidence in docs/BUILD-LOG.md. Configuration
and presentation-only work use build/lint/browser verification.

1. [x] App foundations: package.json, frontend/vite.config.ts, src/app, backend
   package/config. Verify npm run build and lint in both apps. Environment parser
   rejects invalid production storage/secrets; test in backend/tests/config.test.ts.
2. [x] Startup/API foundation: backend/src/app.ts, server.ts, middleware/errors.ts.
   createApp() returns Express app; start() awaits Mongo connection before listen.
   Test liveness, DB-not-ready 503, unknown routes and production-safe errors.
3. [x] Models: backend/src/modules/models.ts and validation.ts. Taxonomy supports
   shared SubjectOffering; FileAsset stores hash/source paths; session revocation
   is persisted. Test invalid status/code/relationship and publication visibility.
4. [x] Import: backend/scripts/import.ts, migration/inventory.ts. buildInventory(root)
   returns hashes, source labels, conflicts and subject entries; seed dry-run makes
   no database writes. Test 140 paths/77 unique binaries and known CSE conflicts;
   test repeated import without duplicates. Export public source-backed snapshot.
5. [x] Auth: backend/src/modules/auth.ts, scripts/create-admin.ts. requireUser checks
   active session/account; requireRole gates access. API tests: CSRF, forced change,
   refresh rotation/replay, logout, deactivation and contributor/admin separation.
6. [x] Storage/upload: backend/src/storage/*, modules/files.ts. put/get/delete/readUrl
   adapters; validatePdf(buffer,mime) rejects fake/oversize/malformed PDFs. Test
   pending access, local range preview and download idempotency.
7. [x] Public API: modules/catalog.ts and inbox.ts. Validated faceted lists, related
   papers, suggestions, Atlas/fallback search and reports. Test published-only,
   bounded paging, invalid filters, text query and zero-result event recording.
8. [x] Public UI: frontend/src/features/catalog, components, styles. Search, branches,
   filters, detail preview and reports. Build/lint and mobile/keyboard browser checks.
9. [x] Notes: frontend/src/features/notes and backend note contracts. PDF/Markdown
   publishing, author credit, tags/units, linked tabs. Test unsafe HTML exclusion,
   unpublished visibility and note download/view counts; build frontend.
10. [x] Staff workspace: modules/admin.ts, contributor.ts, frontend/features/staff.
    CRUD/bulk upload, file replacement/revisions, taxonomy merges/reorder, accounts,
    moderation, inbox and audit. Test edit authorization, reject reason, publication,
    restore and duplicate merge behavior. Browser-check staff workflow.
11. [x] Analytics: modules/analytics.ts, frontend/features/staff/Analytics.tsx.
    recordBatch() deduplicates events and daily uniques, expires raw data. Test DNT,
    staff/bots, concurrent duplicate events, timezone boundaries, CSV injection.
12. [x] Resilience/SEO: frontend/src/lib/api.ts, scripts/prerender.ts, snapshot export.
    Bounded read retry and snapshot fallback, route metadata/sitemap/redirects. Test
    outage behavior and prerendered HTML; check old-link mapping.
13. [x] Release: scripts/smoke-test.mjs, render.yaml, frontend/vercel.json, README,
    TROUBLESHOOTING. Run all tests/build/lint, browser checks and security dependency
    audit. Record actual results and exact remaining external configuration.
