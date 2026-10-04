import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { snapshotSchema } from "../src/snapshot.js";

try {
  const path = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(import.meta.dirname, "../../frontend/public/snapshot.json");
  const snapshot = snapshotSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  console.info(
    `Snapshot validated: ${snapshot.papers.length} papers, ${snapshot.notes.length} notes. Public fields only.`,
  );
} catch {
  console.error(
    "Snapshot validation failed. Keep the previous deployed snapshot and inspect the local artifact.",
  );
  process.exitCode = 1;
}
