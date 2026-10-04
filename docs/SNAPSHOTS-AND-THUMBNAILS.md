# Snapshots and PDF thumbnails

Snapshots keep published browsing and static SEO current. Thumbnails show the
first PDF page without loading the complete document. Originals remain unchanged.

## Local commands

Start the local database and API as described in the README. From the repository
root, run:

```powershell
npm run thumbnails:backfill
npm run snapshot:refresh
npm run snapshot:package
```

Backfill processes missing thumbnails sequentially and safely resumes on a later
run. It supports both local and private S3 storage through the existing backend
environment. New uploads attempt thumbnail generation automatically. Duplicate
uploads reuse the existing file and thumbnail. The importer preserves originals;
run backfill after importing an archive.

`snapshot:refresh` exports the current database, validates the public artifact,
and builds the frontend HTML, sitemap and saved library. `snapshot:package`
validates the built snapshot and prepares `.vercel/output` for a prebuilt deploy.
Packaging is a local operation and does not publish anything.

For a separate export path, use:

```powershell
node --import tsx backend/scripts/export-snapshot.ts --output .npm-cache/review-snapshot.json
```

## Enable the six-hour workflow

The prepared workflow is `.github/workflows/refresh-snapshot.yml`. It has manual
dispatch and a schedule at minute 17 every six hours: 05:47, 11:47, 17:47 and
23:47 Asia/Calcutta. Scheduled execution remains disabled until the repository
variable `SNAPSHOT_AUTOMATION_ENABLED` is set to `true`.

1. Add this implementation and workflow to the repository's default branch.
   Git metadata was read-only in this workspace; no commit or push was made here.
2. Create an Atlas database user with the **read** role on the platform database.
   Add its connection string as the GitHub Actions secret `SNAPSHOT_MONGODB_URI`.
   Permit the runner to reach Atlas using your approved network access setup.
   A runner with fixed egress can use a narrow IP allowlist. The exporter disables
   automatic index and collection creation and does not need API or bucket secrets.
3. Configure these repository variables:

   | Variable                      | Value                                                     |
   | ----------------------------- | --------------------------------------------------------- |
   | `VITE_API_BASE_URL`           | HTTPS API URL ending in `/api`                            |
   | `VITE_SITE_URL`               | Canonical HTTPS frontend origin, without a trailing slash |
   | `VITE_CONTACT_EMAIL`          | Real contact email                                        |
   | `SNAPSHOT_AUTOMATION_ENABLED` | `true` after the manual build succeeds                    |

4. Run **Refresh published library snapshot** manually in GitHub Actions. Check
   the export, validation and build steps. Download the `published-library-*`
   artifact: it contains the contents of `.vercel/output`, including its
   `config.json` and `static/` directory. It is retained for seven days.

Scheduled workflows run from the default branch and can be delayed by GitHub
load; the six-hour interval is a target, not an exact publication deadline.
See [GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Optional automatic Vercel publication

Artifact creation alone does not change the live Vercel site. To publish the
prepared output after each successful build, add the GitHub Actions secret
`VERCEL_TOKEN` and repository variables `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`
for your existing frontend project. Enable `SNAPSHOT_DEPLOY_ENABLED=true` only
when that project and the public build variables are correct.

The workflow publishes with Vercel CLI's `deploy --prebuilt --prod`. The artifact
uses [Vercel's Build Output API](https://vercel.com/docs/build-output-api/configuration),
including clean public routes, legacy redirects, static cache headers and SPA
fallback. Its HTML, sitemap and snapshot come from the same successful build.
The deployed artifact contains public content; it does not contain the MongoDB
connection string, backend JWT secrets or private storage keys/URLs.

To publish a downloaded artifact manually, place its contents in `.vercel/output`
in a directory linked to the intended Vercel project, then use:

```powershell
npx vercel@62.2.0 deploy --prebuilt --prod
```

See [Vercel's prebuilt deploy documentation](https://vercel.com/docs/cli/deploy#prebuilt).
No Vercel or GitHub action was activated from this local workspace.

## Failure handling and takedowns

The exporter uses an explicit public field list and excludes pending, draft,
rejected and deleted records. Validation rejects private/unknown fields, invalid
publication states and inconsistent totals. It validates before writing a
temporary file, then replaces the snapshot atomically. An export or build failure
prevents the workflow's publish step, preserving the previous deployment.

After an urgent takedown, manually run export/build/publication immediately and
purge cached snapshots/HTML in Cloudflare. The live thumbnail endpoint checks
document visibility on every request and sends `private, no-store`, so a hidden
PDF's thumbnail becomes unavailable to public visitors immediately. Saved content cannot update
while the API and build services are unavailable.

## Thumbnail limits and access

Thumbnails are WebP images of page one, at most 480 pixels along the longest edge.
Rendering runs in a separate process with a ten-second timeout, a 128 MB V8 heap
limit, bounded page/image dimensions and a 512 KB output limit. PDFs over 20 MB
skip rendering even if the configured PDF upload limit is higher. Native canvas
memory is separate from the V8 heap limit; the API processes one thumbnail at a
time. Concurrent uploads may keep an icon and can be retried with backfill.

Rendering and thumbnail-storage errors preserve the accepted PDF. Backfill exits
with a failure status when any thumbnail is unavailable and prints counts, so
operators can retry after resolving the cause. Cards and detail pages load images
lazily and fall back to the document icon after an image error. Full PDF previews
still load only on request. Thumbnail reads do not add download analytics.

Thumbnail objects remain in the private storage adapter. The API streams them
after applying the same public/admin/owner visibility checks as the PDF, including
account and password-change restrictions. The frontend uses credentialed CORS
image loading for sibling API origins. Snapshot entries contain a `hasThumbnail`
boolean and never contain thumbnail object keys or expiring storage links.
