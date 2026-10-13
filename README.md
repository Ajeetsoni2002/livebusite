<div align="center">

<img src="images/logo.png" alt="BUIT Papers logo" width="96" />

# BUIT Papers

**Previous-year question papers and subject notes for Barkatullah University Institute of Technology (BUIT), Bhopal — free, searchable and organised by branch and semester.**

[![Live site](https://img.shields.io/badge/Live%20site-livebusite.pages.dev-2ea44f?style=for-the-badge&logo=cloudflare&logoColor=white)](https://livebusite.pages.dev)

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare%20Pages%20%2B%20R2-F38020?logo=cloudflare&logoColor=white)

### 👉 [Open the site](https://livebusite.pages.dev)

</div>

---

## ✨ What you can do

| | |
|---|---|
| 📚 **Browse papers** | Pick your program, branch, semester and subject. First-year papers show up in every branch. |
| 🔍 **Search fast** | Search by subject name, paper code (e.g. `CSE-703`) or branch code. |
| 👀 **Preview before downloading** | Read papers in the browser, page by page. |
| 📝 **Subject notes** | Short notes alongside the papers. |
| 🤝 **Contribute** | Students can request a contributor account and upload papers. Uploads go through admin review. |
| 🏆 **Contributor profiles** | Public profiles and a leaderboard credit everyone who helps. |
| 🌙 **Light and dark mode** | Works well on mobile. |

## 🛠️ Tech stack

- **Frontend:** React, Vite, TypeScript, TanStack Query, PDF.js
- **Backend:** Node.js, Express, MongoDB
- **Storage and hosting:** Cloudflare Pages (site), Cloudflare R2 (PDFs), Render (API)

## 🚀 Run it locally

Needs Node 22.14+ and MongoDB.

```bash
npm ci
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run db:dev   # local MongoDB, keep this terminal open
npm run dev      # web: http://localhost:5173 · API: http://localhost:4000/api
```

Deployment guide (Hindi/Hinglish): [docs/DEPLOYMENT-HI.md](docs/DEPLOYMENT-HI.md)

## 🙌 Want to help?

Have papers that are missing from the site? [Become a contributor](https://livebusite.pages.dev/contribute) and upload them. Bug reports and suggestions are welcome as [issues](https://github.com/Ajeetsoni2002/livebusite/issues).

---

<div align="center">

Made by [Ajeet Kumar Soni](https://ajeet-portfolio-welcome10.vercel.app/) and team.

<sub>This is an unofficial student resource and is not affiliated with Barkatullah University.</sub>

</div>
