# BUIT Papers ko live kaise karein

Yeh guide isi repository ke commands aur configuration ke liye hai. Recommended setup: **Vercel frontend + Render backend + MongoDB Atlas database + private Cloudflare R2 PDF bucket**. Domain aur provider accounts aapko apne account se configure karne hain; is guide se automatic deployment nahi hota.

## 1. Domain aur accounts ready karein

GitHub, Vercel, Render, MongoDB Atlas aur Cloudflare accounts ready rakhein. Ek domain use karein. Neeche `YOUR_DOMAIN.COM` ko apne domain se replace karein:

| Service | Example address |
| --- | --- |
| Public website | `https://www.YOUR_DOMAIN.COM` |
| API | `https://api.YOUR_DOMAIN.COM` |
| Admin login | `https://www.YOUR_DOMAIN.COM/admin/login` |

**Current login code ke liye same domain ke subdomains zaroori hain.** Frontend sirf `vercel.app` aur API sirf `onrender.com` par rakhne se cross-site authentication cookies kaam nahi karengi. Local admin account bhi production Atlas database mein automatically nahi jayega; step 6 mein production admin create karna hai.

Render par always-on instance use karein. R2 activation/billing aur provider plan ki current conditions dashboard par check karein. Apna existing portfolio Vercel project alag rakhein; BUIT ke liye naya project banayein.

## 2. Latest code GitHub par push karein

PowerShell mein project root kholein:

```powershell
cd 'D:\Office stuff\Apptitude plateform\livebusite'
npm run lint
npm run build
git status --short
git add .
git diff --cached --stat
git commit -m "Add Solar Archive, creator credits and story page"
git push origin HEAD
```

Existing remote `https://github.com/Ajeetsoni2002/livebusite.git` hai. Agar GitHub login maange, apne GitHub account se authenticate karein. Branch ka naam Vercel aur Render mein isi pushed branch par set karein.

`.env`, uploads, node_modules aur local cache `.gitignore` mein hain. Staged diff mein secret file nahi honi chahiye. **Poora repository push karein**, sirf `frontend` folder nahi: build original `images`, `Portfolio_Website` aur `migration/manifest.json` bhi padhta hai.

## 3. MongoDB Atlas database banayein

1. Atlas mein project aur cluster banayein.
2. Database Access mein application user banayein; `buit_papers` database par read/write role dein. Database password save karein.
3. Network Access mein apna current public IP add karein, kyunki initial import apne PC se chalega.
4. Connect → Drivers → Node.js se connection URI copy karein. Database name `buit_papers` rakhein; password ke special characters URL-encode karein.
5. Step 5 mein Render service banne ke baad uske **Connect → Outbound** IP ranges bhi Atlas Network Access mein add karein. Permanent access ke liye `0.0.0.0/0` ki jagah required addresses use karein.

Example URI:

```text
mongodb+srv://DB_USER:URL_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/buit_papers?retryWrites=true&w=majority
```

Official references: [Atlas connection setup](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/) and [Render outbound IP addresses](https://render.com/docs/outbound-ip-addresses).

## 4. Cloudflare R2 PDF bucket banayein

1. Cloudflare → R2 Object Storage → Create bucket: example `buit-papers`.
2. Bucket private rakhein; public `r2.dev` access enable na karein. API signed links deta hai.
3. R2 API token banayein: Object Read & Write, sirf isi bucket ke liye. Access Key ID aur Secret Access Key save karein.
4. Account ID se endpoint banega: `https://ACCOUNT_ID.r2.cloudflarestorage.com`. Region `auto` hai.
5. Bucket Settings → CORS policy mein apne frontend ka exact origin set karein:

```json
[
  {
    "AllowedOrigins": ["https://www.YOUR_DOMAIN.COM"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Official references: [R2 setup](https://developers.cloudflare.com/r2/get-started/) and [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).

## 5. Render backend deploy karein

Render → New → Web Service → GitHub repository connect karein. `render.yaml` se Blueprint bhi import kar sakte hain. Manual Web Service settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Root Directory | Empty — repository root |
| Build Command | `npm ci --include=dev && npm run build -w backend` |
| Start Command | `npm run start -w backend` |
| Health Check Path | `/api/health` |

Environment mein yeh values add karein:

```dotenv
NODE_VERSION=24
NODE_ENV=production
MONGODB_URI=YOUR_ATLAS_URI
STORAGE_DRIVER=s3
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=buit-papers
S3_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY
S3_SECRET_ACCESS_KEY=YOUR_R2_SECRET
SITE_URL=https://www.YOUR_DOMAIN.COM
API_URL=https://api.YOUR_DOMAIN.COM
CORS_ORIGINS=https://www.YOUR_DOMAIN.COM
CONTACT_EMAIL=YOUR_REAL_CONTACT_EMAIL
JWT_ACCESS_SECRET=FIRST_RANDOM_SECRET
JWT_REFRESH_SECRET=SECOND_RANDOM_SECRET
ANALYTICS_SECRET=THIRD_RANDOM_SECRET
TRUST_PROXY=0
ATLAS_SEARCH_ENABLED=false
```

Teen independent secrets generate karne ke liye command **teen baar** chalayein; har output ko alag variable mein paste karein:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`PORT` Render khud provide karta hai; `4000` hardcode na karein. `TRUST_PROXY=0` conservative starting value hai; production proxy path verify karke trusted hop count set karein, warna client-IP rate limits/analytics proxy IP par group ho sakte hain. Cloudflare proxy initially DNS-only rakhein; extra proxy baad mein configure karein.

Service Settings → Custom Domains mein `api.YOUR_DOMAIN.COM` add karein. DNS provider mein Render ke diye records add karein; verification/TLS complete hone dein. Atlas mein service ke outbound IP ranges allow karke redeploy karein.

Browser mein `https://api.YOUR_DOMAIN.COM/api/health` kholein. HTTP 200 aur `database: connected` expected hai. Agar 503 aaye to Atlas URI, credentials aur Network Access check karein. Official reference: [Render Express deployment](https://render.com/docs/deploy-node-express-app).

## 6. Production papers aur admin create karein

Apne PC par **development `.env` overwrite na karein**. Separate ignored file banayein:

```powershell
Copy-Item backend/.env.example backend/.env.production
```

`backend/.env.production` mein step 5 wale actual production values paste karein; `NODE_ENV=production` aur `STORAGE_DRIVER=s3` hona chahiye. Isi file mein add karein:

```dotenv
ADMIN_EMAIL=YOUR_ADMIN_EMAIL
ADMIN_NAME=Ajeet Kumar Soni
ADMIN_PASSWORD=YOUR_NEW_TEMPORARY_PASSWORD
```

Password 12–128 characters ka rakhein. Pehle diya local test password live site par reuse na karein. Commands project root se chalayein:

```powershell
node --env-file=backend/.env.production --import tsx backend/scripts/import.ts --dry-run
node --env-file=backend/.env.production --import tsx backend/scripts/import.ts
node --env-file=backend/.env.production --import tsx backend/scripts/backfill-thumbnails.ts
node --env-file=backend/.env.production --import tsx backend/scripts/create-admin.ts
node --env-file=backend/.env.production --import tsx backend/scripts/export-snapshot.ts
node --env-file=backend/.env.production --import tsx backend/scripts/validate-snapshot.ts
```

Import source PDFs ko R2 mein upload karega aur Atlas catalog banayega. Development database export ko production mein seedha copy mat karein: local file keys production bucket mein available nahi hoti. Fresh import inventory mein 77 unique PDFs hain; initial public/pending division source metadata par depend karta hai. Conflicting records admin moderation mein review karein.

Admin creation output `Admin created` hona chahiye. Account already exists aaye to script password reset nahi karega. First login par temporary password badalna compulsory hai. Creation ke baad `.env.production` se `ADMIN_PASSWORD` hata dein; Render ko admin bootstrap password ki zaroorat nahi.

Snapshot export public file update karta hai. Is update ko GitHub par push karein, taaki initial Vercel snapshot production IDs se match kare:

```powershell
git add frontend/public/snapshot.json frontend/public/branding
git commit -m "Refresh published production snapshot"
git push origin HEAD
```

## 7. Vercel frontend deploy karein

Vercel → Add New → Project → **isi GitHub repository** ko import karein. Existing portfolio project select na karein.

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Include source files outside Root Directory | Enabled |
| Install Command | `npm ci --include=dev --prefix ..` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | 24.x |

Outside-root access required hai: frontend build parent directory ki original branding, portfolio aur manifest read karta hai. Build command `frontend/vercel.json` mein bhi configured hai.

Production environment variables:

```dotenv
VITE_API_BASE_URL=https://api.YOUR_DOMAIN.COM/api
VITE_SITE_URL=https://www.YOUR_DOMAIN.COM
VITE_CONTACT_EMAIL=YOUR_REAL_CONTACT_EMAIL
```

Database URI, R2 keys ya JWT secrets Vercel frontend/VITE variables mein paste na karein. Deploy karein; Settings → Domains mein `www.YOUR_DOMAIN.COM` add karke Vercel ke diye DNS records apply karein. Agar env baad mein change karein to **Redeploy** karein, kyunki Vite values build time par include hoti hain.

SPA fallback aur story redirects `frontend/vercel.json` mein hain. Deep links ka browser refresh work karna chahiye. Official references: [Vercel build settings](https://vercel.com/docs/builds/configure-a-build) and [Vercel monorepos](https://vercel.com/docs/monorepos).

## 8. Live website verify karein

1. `/`, `/papers`, `/notes`, `/about`, `/our-story` aur `/admin/login` directly open karein; refresh par 404 nahi aana chahiye.
2. Home, contribution banner, story aur footer mein **Ajeet Kumar Soni** ke portfolio links check karein.
3. Mobile par dark/light toggle, branch finder, subject filters aur search check karein.
4. Published PDF thumbnail, full preview aur download check karein. Sirf catalog dikhna PDF storage working hone ka proof nahi hai.
5. Step 6 wale production admin se login karein, password change karein, page refresh karein aur signed-in state verify karein.
6. Contributor create karke temporary-password change aur upload/moderation check karein.
7. Contact form, copyright email, `/sitemap.xml` aur canonical domain verify karein.
8. Live mobile Lighthouse measure karein. Current local design measurement 76 / LCP 3.56s tha; performance target abhi unresolved hai. Actual production result separately measure karein.

## Common problems

| Problem | Kya check karein |
| --- | --- |
| Root page old static site dikhata hai | Vercel Root Directory `frontend`, Output `dist`, latest pushed branch |
| Our Story refresh par 404 | Latest deployment, `/about`, story redirects and SPA fallback |
| Frontend build mein ENOENT/images error | Entire repository pushed ho; outside-root source access enabled ho |
| Admin login ke baad logout | Frontend/API same base domain, HTTPS, exact CORS origin, real production account |
| API health 503 | Atlas network access, URI and DB user permissions |
| No papers / saved library only | Render logs, production import, API URL and fresh snapshot |
| PDF preview/download fails | R2 endpoint, bucket token, actual production upload and bucket CORS |
| Theme/fonts missing | Latest `vercel.json` and built public files; redeploy |
| Workspace command fails inside backend | Root se `npm run create-admin -w backend`; backend folder se `npm run create-admin` |

Later catalog updates ke baad production snapshot export karke frontend redeploy karein. Automated snapshot refresh ka existing setup [SNAPSHOTS-AND-THUMBNAILS.md](SNAPSHOTS-AND-THUMBNAILS.md) mein hai.
