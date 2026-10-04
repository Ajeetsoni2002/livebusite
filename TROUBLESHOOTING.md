# Troubleshooting

## API does not start / readiness is 503

The server connects to MongoDB before accepting traffic. Start `npm run db:dev`
or check your configured Atlas URI/network access. The development helper uses
27018 to avoid an existing service on 27017. An occupied helper port is an error,
not permission to reconfigure that database. Use `DEV_DB_PORT` and matching URI
if necessary. Atlas credentials containing special characters need URI encoding.

MongoDB transactions require a replica set. A standalone database may pass ping
but fail downloads, analytics and merges. Use Atlas, the helper, or a properly
initialized local replica set. `/api/ping` checks liveness; `/api/health` checks DB
connection state. Test both and use readiness as Render’s health endpoint.

## 502 / cold starts

Confirm Render logs, DB availability, configured port and process startup. Free
Render services sleep; application retries cannot prevent that. The client uses
bounded read retries and saved snapshots where available; it must not blindly
retry uploads or other mutations. Use an always-on instance for production.

## Login succeeds but workspace returns 401

Check that frontend and API use HTTPS sibling custom domains. SameSite=Lax cookies
are not sent cross-site between unrelated `vercel.app` and `onrender.com` domains.
Inspect Secure/httpOnly cookie flags, CORS exact origins and Axios credentials.
Development secrets are process-local unless configured: API restart invalidates
those sessions. Set stable independent secrets in `.env`. Clear old cookies after
switching localhost/127.0.0.1. Temporary accounts must change password before access.

## CSRF 403

Reload the page, retrieve a fresh `/api/auth/csrf` token and send its value in
`X-CSRF-Token` with the same cookie session. The UI handles this automatically.
Do not disable CSRF or enable wildcard credentialed CORS. An origin mismatch is
a configuration problem. Login lockouts last 15 minutes after five failed attempts.

## Files missing after redeploy

Production startup rejects local storage. Verify private R2 bucket, object keys,
credentials and that the production importer uploaded the original bytes. Merely
copying the development database does not upload its files. Never depend on
Render’s ephemeral filesystem for production PDFs.

## PDF preview or download fails

Pending/deleted papers are not public. Inspect publishing state, offerings and
asset references. R2 signed links expire after 120 seconds; request a fresh link.
Check bucket CORS and Range support. Invalid, encrypted or unreadable PDFs are
rejected for new uploads. Admin file replacement retains the previous asset
reference. A first-page thumbnail is not required for preview.

## Missing subject/year or duplicate import

Inspect `migration/manifest.json`. Conflicting HTML labels and filenames are not
guessed. CSE-102 and CSE-504 contain known bad source links. Review the PDF and
edit metadata through moderation. Blank legacy links have no file to import.
Repeated imports preserve moderation decisions. File hash deduplication prevents
the two mirrored source folders from doubling the library. The Paper collection
is named `paper` by Mongoose’s default pluralizer.

## Search typos do not match

Check the Atlas autocomplete index and `ATLAS_SEARCH_ENABLED`. Fallback searches
are bounded subject/code/title matches with limited typo support. Facets use
database IDs internally; regenerated snapshots must match the current DB.

## Analytics counts look different

Counts respect DNT, exclude staff/recognized crawlers and rotate at Kolkata
midnight. Download counts measure issued download actions, not completed byte
transfers. Country remains Unknown until a verified Cloudflare header path is
configured. Only submitted search queries count; suggestion keystrokes do not.
Do not enable raw-IP logging to investigate a discrepancy.

## Stale snapshot, sitemap or Open Graph title

Export the published database snapshot and rebuild/redeploy the frontend. Client
navigation updates titles, while link preview crawlers need the prerendered HTML.
Vite development mode is an SPA; inspect production build output for static SEO.
After takedown, regenerate and purge public cached snapshots/HTML promptly.

For the scheduled workflow, confirm `SNAPSHOT_AUTOMATION_ENABLED=true`, the
read-only `SNAPSHOT_MONGODB_URI` secret and HTTPS build variables. An artifact-only
run does not update Vercel; publication also requires Vercel credentials and
`SNAPSHOT_DEPLOY_ENABLED=true`. Export/validation failures deliberately preserve
the previous deployment. See [setup](docs/SNAPSHOTS-AND-THUMBNAILS.md).

## Missing PDF thumbnails

Run `npm run thumbnails:backfill` with the same database/storage environment as
the API. Existing thumbnails are skipped. Check the generated/skipped/failed
counts. PDFs over 20 MB skip rendering; malformed or slow pages and unavailable
object storage keep the original PDF and document icon. The renderer requires
Node 22.14+ and the installed PDF.js/native canvas dependencies. Confirm the API
can read the private thumbnail object and that its document is visible to the
current visitor. Separate frontend/API origins must use the configured CORS
allowlist. The thumbnail endpoint does not issue signed storage links.

## Windows install/build errors

Use Node 22.14+ and `npm ci` from the repository root. This project has npm
workspaces; avoid independent incompatible lockfiles. If ComSpec is missing in
a restricted terminal, set `$env:ComSpec='C:\Windows\System32\cmd.exe'`. Cache
is local `.npm-cache/` to avoid permissions outside the workspace. Do not use
destructive cleanup commands on paths containing spaces. Stop only processes
you started before clearing their files.
