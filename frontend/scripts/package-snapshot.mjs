import { cp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotSchema } from "../../backend/src/snapshot.ts";

const frontend = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(frontend, "..");
const dist = resolve(frontend, "dist"),
  output = resolve(root, ".vercel/output");
// Only the fixed generated output directory is ever replaced.
if (relative(root, output) !== join(".vercel", "output"))
  throw new Error("Invalid artifact directory");
snapshotSchema.parse(
  JSON.parse(await readFile(resolve(dist, "snapshot.json"), "utf8")),
);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(dist, resolve(output, "static"), { recursive: true });
const project = JSON.parse(
  await readFile(resolve(frontend, "vercel.json"), "utf8"),
);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const routes = [
  ...project.redirects.map((redirect) => ({
    src: `^${escape(redirect.source)}$`,
    headers: { Location: redirect.destination },
    status: redirect.permanent ? 308 : 307,
  })),
  {
    src: "^/.*$",
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    continue: true,
  },
  {
    src: "^/snapshot\\.json$",
    headers: { "Cache-Control": "public, max-age=300, must-revalidate" },
    continue: true,
  },
  {
    src: "^/assets/.*$",
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    continue: true,
  },
  { handle: "filesystem" },
  {
    src: "^/((?!assets/|branding/|legacy/|snapshot\\.json$|sitemap\\.xml$|robots\\.txt$).*)$",
    dest: "/index.html",
  },
];
const overrides = {};
async function cleanRoutes(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await cleanRoutes(path);
    else {
      const name = relative(dist, path).replaceAll("\\", "/");
      if (name.endsWith("/index.html") && !name.startsWith("legacy/"))
        overrides[name] = { path: name.slice(0, -"/index.html".length) };
    }
  }
}
await cleanRoutes(dist);
// This folder follows Vercel's Build Output API, suitable for deploy --prebuilt.
await writeFile(
  resolve(output, "config.json"),
  JSON.stringify({ version: 3, routes, overrides }, null, 2),
);
console.info(
  "Prepared published static frontend in .vercel/output; no database or storage credentials are included.",
);
