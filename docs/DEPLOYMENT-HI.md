# BUIT Papers ko live kaise karein

Yeh guide isi repository ke commands aur configuration ke liye hai. Aapka selected setup: **Cloudflare Pages frontend + Render backend + MongoDB Atlas database + private Cloudflare R2 PDF bucket**. Domain aur provider accounts aapko apne account se configure karne hain; is guide se automatic deployment nahi hota.

## 1. Domain aur accounts ready karein

GitHub, Render, MongoDB Atlas aur Cloudflare accounts ready rakhein. Ek domain use karein. Neeche `YOUR_DOMAIN.COM` ko apne domain se replace karein:

| Service | Example address |
| --- | --- |
| Public website | `https://www.YOUR_DOMAIN.COM` |
| API | `https://api.YOUR_DOMAIN.COM` |
| Admin login | `https://www.YOUR_DOMAIN.COM/admin/login` |

**Direct cross-site API calls ke saath current login cookies kaam nahi karengi.** Custom domain ke sibling subdomains use karein, ya implemented Pages same-origin API proxy configure karein. Aapke current `livebusite.pages.dev` + Render setup ke exact steps [PAGES-API-PROXY-HI.md](PAGES-API-PROXY-HI.md) mein hain. Is proxy ke saath custom domain required nahi hai. Local admin account production Atlas database mein automatically nahi jayega; fresh production DB par step 6 mein admin create karein. Existing production admin ko dobara create na karein.

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

Existing remote `https://github.com/Ajeetsoni2002/livebusite.git` hai. Agar GitHub login maange, apne GitHub account se authenticate karein. Branch ka naam Cloudflare Pages aur Render mein isi pushed branch par set karein.

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

Apne PC par **development `.env` overwrite na karein**. Separate ignored file `backend/.env.production` use karein. Agar file pehle se hai to uske generated secrets preserve karein; sirf missing values fill karein. File na ho tab:

```powershell
if (!(Test-Path backend/.env.production)) {
  Copy-Item backend/.env.example backend/.env.production
}
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

Snapshot export public file update karta hai. Is update ko GitHub par push karein, taaki initial Pages snapshot production IDs se match kare:

```powershell
git add frontend/public/snapshot.json frontend/public/branding
git commit -m "Refresh published production snapshot"
git push origin HEAD
```

## 7. Cloudflare Pages frontend deploy karein

### 7.1 Latest changes push karein

Cloudflare-specific `_redirects` aur `_headers` files `frontend/public` mein hain. Agar abhi commit nahi kiya to project root se:

```powershell
git add frontend/public/_redirects frontend/public/_headers docs/DEPLOYMENT-HI.md
git commit -m "Configure Cloudflare Pages deployment"
git push origin HEAD
```

Pehle ke application changes bhi pushed hone chahiye; sirf in teen files ko push karna sufficient nahi hai agar step 2 pending hai.

### 7.2 GitHub repository connect karein

Cloudflare Dashboard → **Workers & Pages → Create application → Pages → Import an existing Git repository**. Dashboard wording slightly different ho sakti hai; Pages project aur Git integration choose karein. Ordinary Worker deploy screen select na karein.

GitHub authorize karein aur `Ajeetsoni2002/livebusite` repository choose karein. Agar Pages project pehle se bana hai, uske **Settings → Builds & deployments** mein settings update karein. Project name example `buit-papers` rakhein aur production branch wahi choose karein jahan latest code push hua hai.

### 7.3 Exact build settings fill karein

| Setting | Value |
| --- | --- |
| Framework Preset | None — custom workspace build |
| Root Directory | Empty — repository root |
| Build Command | `npm ci --include=dev && npm run build -w frontend` |
| Build Output Directory | `frontend/dist` |

**Root `frontend` mat set karein with these settings.** Command repository root se workspace build karta hai. Build original images, portfolio aur migration manifest read karta hai; poora repository available hona chahiye. Backend isi Pages project par run nahi hota; woh Render par rahega.

### 7.4 Production build variables add karein

Initial setup ke environment variables section, ya project **Settings → Environment variables / Variables and Secrets** mein Production select karke:

```dotenv
NODE_VERSION=24
SKIP_DEPENDENCY_INSTALL=true
VITE_API_BASE_URL=https://api.YOUR_DOMAIN.COM/api
VITE_SITE_URL=https://www.YOUR_DOMAIN.COM
VITE_CONTACT_EMAIL=YOUR_REAL_CONTACT_EMAIL
```

**Custom domain nahi hai?** Upar ka direct-API configuration use karne ki jagah [Pages API proxy guide](PAGES-API-PROXY-HI.md) follow karein: `VITE_API_BASE_URL=/api`, `VITE_SITE_URL=https://livebusite.pages.dev`, aur runtime `API_ORIGIN=https://buit-papers-api.onrender.com`. Render mein SITE_URL/CORS frontend ke `pages.dev` origin par set karein. Is case mein section 7.6 ka custom-domain step optional hai.

`SKIP_DEPENDENCY_INSTALL=true` automatic installation skip karta hai, kyunki build command khud `npm ci --include=dev` chalata hai. `NODE_ENV=production` add karna required nahi hai: Vite build production build banata hai.

API URL ke end mein **`/api`** zaroor ho. Domain/contact placeholders actual values se replace karein. Database URI, R2 keys aur JWT secrets frontend/VITE variables mein paste na karein. Preview deployments ke liye separate Preview values bhi configure kar sakte hain; random preview hosts par current production admin login supported nahi hai.

Official references: [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [Node version / dependency installation](https://developers.cloudflare.com/pages/configuration/build-image/).

### 7.5 Save and Deploy karein

Build logs mein frontend Vite build aur `Prerendered ... public pages and sitemap` success message expected hai. Publish hone ke baad `https://PROJECT_NAME.pages.dev` address milega. Is par layout check kar sakte hain; full admin login acceptance test custom domain par karein.

Cloudflare `frontend/vercel.json` use nahi karta. Story aliases ke redirects `frontend/public/_redirects` se aur asset headers `_headers` se build output mein copy hote hain. Top-level `404.html` add na karein: Pages ka default SPA fallback React ke deep routes ko handle karega, jabki existing prerendered files normally serve hongi. Official reference: [Pages route matching and SPA behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).

### 7.6 Frontend custom domain attach karein

Pages project → **Custom domains → Set up a custom domain** → `www.YOUR_DOMAIN.COM` add karein. Agar domain ka DNS Cloudflare par managed hai to suggested record confirm karein; external DNS ho to Pages ke instructions ke mutabik CNAME apply karein. **Sirf DNS record add karke project association skip na karein.** Domain verification aur HTTPS ready hone dein. [Official custom-domain steps](https://developers.cloudflare.com/pages/configuration/custom-domains/).

Render ka API domain `api.YOUR_DOMAIN.COM` rahega. Render environment mein:

```dotenv
SITE_URL=https://www.YOUR_DOMAIN.COM
API_URL=https://api.YOUR_DOMAIN.COM
CORS_ORIGINS=https://www.YOUR_DOMAIN.COM
```

Extra frontend domains intentionally use karein to CORS mein exact comma-separated origins add karein. Wildcard ya trailing slash na use karein. R2 CORS mein bhi frontend origin same hona chahiye.

### 7.7 Changed variables ke baad rebuild karein

Vite environment values build time par embed hoti hain. Variable update karne ke baad Pages **Deployments → Retry deployment / new deployment** se fresh build chalayein. Git-connected Pages project latest production branch ke new push par bhi rebuild karega. `Rollback` old build restore karta hai; changed variables ke liye fresh build chahiye.

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
| Root page old static site dikhata hai | Pages Root Directory empty, Output `frontend/dist`, latest pushed branch |
| Our Story refresh par 404 | Latest deployment, `/about`, story redirects and SPA fallback |
| Frontend build mein ENOENT/images error | Entire repository pushed ho; Pages root empty ho |
| Admin login ke baad logout | Frontend/API same base domain, HTTPS, exact CORS origin, real production account |
| API health 503 | Atlas network access, URI and DB user permissions |
| No papers / saved library only | Render logs, production import, API URL and fresh snapshot |
| PDF preview/download fails | R2 endpoint, bucket token, actual production upload and bucket CORS |
| Theme/fonts missing | Latest built public files aur output `frontend/dist`; fresh build deploy karein |
| Workspace command fails inside backend | Root se `npm run create-admin -w backend`; backend folder se `npm run create-admin` |

Later catalog updates ke baad production snapshot export, validate aur updated public snapshot GitHub par push karein; Pages production branch push se rebuild karega. Existing [SNAPSHOTS-AND-THUMBNAILS.md](SNAPSHOTS-AND-THUMBNAILS.md) mein optional Vercel publisher bhi documented hai; use Pages deployment samajhkar enable na karein. Automated exporter ke artifacts se alag Pages publish integration chahiye, ya manual export/commit/push use karein.
