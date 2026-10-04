# Cloudflare Pages par same-origin API proxy

Is project mein proxy implement ho chuka hai. Flow:

```text
Browser -> https://livebusite.pages.dev/api/... -> Pages Function -> Render API
```

Browser ki auth/CSRF cookies ab Pages hostname par store hongi. Backend cookie policy `HttpOnly; Secure; SameSite=Lax; Path=/api` aur CSRF verification preserve hoti hai. Admin account ko recreate karne ki zaroorat nahi.

## 1. Files GitHub par push karein

Repository root mein `functions/api/[[path]].ts` proxy hai. `frontend/public/_routes.json` sirf API paths ko Function tak bhejta hai; public pages static rahenge. Function `frontend/functions` ya `frontend/dist/functions` mein move na karein: selected Pages project root repository root hai.

```powershell
git add functions frontend/public/_routes.json frontend/tests/pages-proxy.test.ts frontend/package.json docs/DEPLOYMENT-HI.md docs/PAGES-API-PROXY-HI.md README.md .gitignore
git diff --cached --stat
git commit -m "Add same-origin Cloudflare Pages API proxy"
git push origin HEAD
```

`.env.production` local secret file hai; commit nahi karna. Pehle ke pending application changes bhi GitHub par hone chahiye.

## 2. Cloudflare Pages ki settings confirm karein

Cloudflare Dashboard -> Workers & Pages -> **livebusite** -> Settings -> Builds & deployments:

| Setting | Value |
| --- | --- |
| Root Directory | Empty — repository root |
| Build Command | `npm ci --include=dev && npm run build -w frontend` |
| Build Output Directory | `frontend/dist` |

Git integration use karein. Cloudflare dashboard ka static drag-and-drop upload Functions deploy nahi karta. [Official Function deployment instructions](https://developers.cloudflare.com/pages/functions/get-started/).

## 3. Cloudflare Production variables update karein

Pages project -> Settings -> Variables and Secrets / Environment variables mein **Production** select karein:

```dotenv
NODE_VERSION=24
SKIP_DEPENDENCY_INSTALL=true
VITE_API_BASE_URL=/api
VITE_SITE_URL=https://livebusite.pages.dev
VITE_CONTACT_EMAIL=YOUR_REAL_CONTACT_EMAIL
API_ORIGIN=https://buit-papers-api.onrender.com
```

**Do URLs ka difference:**

- `VITE_API_BASE_URL=/api` browser ke liye hai. Yahan Render URL nahi rehna chahiye.
- `API_ORIGIN` Pages Function ka runtime variable/text binding hai. Yahan Render ka HTTPS origin dein, **bina `/api`**, query ya credentials ke. Variable `context.env.API_ORIGIN` mein available hona chahiye; isko sirf build-only shell variable ki tarah configure na karein.

Database/R2/JWT secrets Pages mein add nahi karne. API origin public address hai. Function sirf configured origin ko forward karta hai; browser arbitrary upstream choose nahi kar sakta. [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/).

Compatibility date `2026-10-01` par set karein if your existing project uses an old date. Yeh date local Worker runtime mein verify hui hai. Proxy mein Node APIs nahi hain; `nodejs_compat` flag required nahi hai.

## 4. Render environment update karein

Render -> **buit-papers-api** -> Environment:

```dotenv
SITE_URL=https://livebusite.pages.dev
API_URL=https://buit-papers-api.onrender.com
CORS_ORIGINS=https://livebusite.pages.dev
```

Existing MongoDB URI, R2 settings aur three JWT/analytics secrets preserve karein. Save and deploy karein. Backend `.env.production` automatically load nahi karta; dashboard mein values import/update karein.

R2 bucket CORS mein `AllowedOrigins` mein `https://livebusite.pages.dev` rakhein, kyunki signed PDF preview redirects browser se directly R2 par jaate hain.

## 5. Pages ka fresh deployment karein

Variables save karne ke baad latest pushed commit ka **Retry deployment / new deployment** chalayein. Logs mein Pages Functions compilation success honi chahiye. Vite variables build-time values hain; old deployment use karne se browser ab bhi direct Render endpoint ko call karega.

`_routes.json` output `frontend/dist/_routes.json` mein hona chahiye. API requests Function par jayengi; static page redirects `_redirects` se rahenge. API auth responses proxy `private, no-store` karta hai. [Function routing](https://developers.cloudflare.com/pages/functions/routing/).

## 6. Proxy health aur login check karein

1. `https://livebusite.pages.dev/api/health` kholein. JSON with HTTP 200 and database connected expected hai.
2. `https://livebusite.pages.dev/api/auth/csrf` kholein. JSON expected hai, homepage HTML nahi. Token ko share na karein.
3. Admin page par hard refresh karein: `Ctrl+Shift+R`.
4. DevTools -> Network mein login Request URL **`https://livebusite.pages.dev/api/auth/login`** hona chahiye. Direct `onrender.com` URL aaye to deployed Vite variable abhi wrong/old hai.
5. Application -> Cookies -> `https://livebusite.pages.dev` par `csrf` cookie present honi chahiye. Successful login ke baad `access` aur `refresh` cookies bhi milengi. HttpOnly cookies `document.cookie` se nahi dikhengi.
6. Existing **production** admin credentials se login karein. Required ho to first-login password change complete karein. Page refresh, logout/relogin, PDF preview/download aur one test upload verify karein.

## Troubleshooting

| Result | Meaning / next step |
| --- | --- |
| `/api/health` returns homepage HTML | Function deploy nahi hui; root/functions path, Git deployment and build logs check karein |
| `503 PROXY_CONFIG_REQUIRED` | Runtime `API_ORIGIN` missing/invalid; exact HTTPS backend origin bind karke redeploy karein |
| `502 PROXY_UPSTREAM_UNAVAILABLE` | Render connection fail; Render status, logs and API health check karein |
| Login request still direct Render | `VITE_API_BASE_URL=/api` set karke fresh frontend build karein |
| `403 CSRF_REQUIRED` | Request URL, Pages cookie, CSRF header, Render CORS and stable JWT secret check karein |
| `401 LOGIN_FAILED` | Request CSRF check tak pahunch gayi; account/password/lock status separately investigate karein |
| `429` | Rate limit reached; retry window wait karein; proxy hop/IP configuration verify karein |

Proxy broad CORS access enable nahi karta aur CSRF verification remove nahi karta. Preview deployments ke origins intentionally allow kiye bina production admin login test na karein. Pages Functions quotas apply to API requests; static paths are excluded through `_routes.json`.

Local verification commands:

```powershell
node --import tsx --test frontend/tests/pages-proxy.test.ts
npm run lint -w frontend
npm run build -w frontend
```

Deployment ke baad live login verification still required hai. Local proxy tests real production password/account validity prove nahi karte.
