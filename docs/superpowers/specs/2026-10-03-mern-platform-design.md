# BUIT papers platform: approved design

The user approved the Phase A plan on 2026-10-03 and requested implementation.
Build alongside the static site without moving or deleting its original files.
Preserve Barkatullah University/BUIT branding, content and attribution. Import
only source-backed records; conflicting metadata stays pending review.

## Architecture
React/Vite/TypeScript frontend, Express/TypeScript API, MongoDB/Mongoose database.
Programs, branches, semesters and shared subject offerings form the taxonomy.
Papers and PDF/Markdown notes have drafts, pending moderation and published states.
Storage adapters support development disk and private S3-compatible R2 storage.
Admin-created contributors use temporary passwords with forced first change.
All contributor submissions initially require moderation.

## Contracts
Cookie access/refresh JWT authentication, persisted rotated sessions, CSRF and
role/ownership checks. PDF MIME/signature/parser validation, random keys and
hash deduplication. Audit records and visitor analytics do not retain raw IPs.
Respect DNT, exclude bots and staff, aggregate analytics daily in Asia/Kolkata.
Connect DB before listening; readiness, graceful shutdown, bounded read retries,
public snapshots and prerendered metadata support outages and indexing.
Admin pages include content/bulk management, taxonomy, contributors, moderation,
reports/requests, audit and 7/30/90-day analytics with CSV export.

## Defaults and deployment
Scope: one university, B.Tech, six branches already named in the source.
Infrastructure recommendation: Atlas, R2, Vercel, always-on Render, Cloudflare.
Real domains, contact email and credentials are deployment inputs, never invented.
Existing paid-contribution offer is archived as source content pending owner review;
the new application does not promise payment without configured policy.
Production requires HTTPS origins, secrets and persistent object storage.

## Acceptance
Both applications support npm run dev; importer supports repeatable dry runs;
admin creation reads environment settings. Meaningful API tests prove authentication,
role permissions, upload rejection, ownership and moderation. Smoke test, setup,
deployment and troubleshooting documentation accompany the application. Browser
checks cover mobile/keyboard discovery and staff journeys. Measured performance
results, external provisioning gaps and unsupported features are reported honestly.
