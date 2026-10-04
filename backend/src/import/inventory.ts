import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { createHash } from "node:crypto";
export type SourceAsset = {
  hash: string;
  size: number;
  sources: string[];
  originalName: string;
  code?: string;
  title: string;
  year?: number;
  session?: string;
  conflicts: string[];
  catalogLinks: { label: string; subject: string; href: string }[];
};
const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export async function buildInventory(root: string) {
  const catalogPath =
    "other pages 1/branch page/other pages2/papers page/allpapers.html";
  const html = await readFile(resolve(root, catalogPath), "utf8");
  const core = html.slice(
    html.indexOf("1ST YEAR ALL AVAILABLE PAPERS"),
    html.indexOf('<script src="https://kit.fontawesome'),
  );
  const subjects: {
    code: string;
    name: string;
    semester: number;
    originalLabel: string;
  }[] = [];
  const links = new Map<string, SourceAsset["catalogLinks"]>();
  let semester = 1;
  for (const match of core.matchAll(
    /<H3><STR(?:ong|Ong)>(\d+)(?:st|nd|rd|th) sem[\s\S]*?<\/H3>|<li><p>\s*([\s\S]*?)<details>([\s\S]*?)<\/details>/gi,
  )) {
    if (match[1]) {
      semester = Number(match[1]);
      continue;
    }
    const label = clean(match[2]),
      codeMatch = label.match(/CSE-\s*(\d{3})/i);
    if (!codeMatch) continue;
    const code = `CSE-${codeMatch[1]}`,
      name = label
        .slice(codeMatch[0].length)
        .replace(/^[\s,-]+/, "")
        .trim();
    subjects.push({ code, name, semester, originalLabel: label });
    for (const a of match[3].matchAll(
      /href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      const p = relative(
        root,
        resolve(
          root,
          "other pages 1/branch page/other pages2/papers page",
          a[1],
        ),
      ).replace(/\\/g, "/");
      const refs = links.get(p) || [];
      refs.push({ label: clean(a[2]), subject: code, href: a[1] });
      links.set(p, refs);
    }
  }
  const byHash = new Map<string, SourceAsset>();
  let sourceFileCount = 0;
  for (const directory of [
    "papers",
    "other pages 1/branch page/other pages2/papers page/papers",
    "New papers",
    "images/son",
  ]) {
    for (const filename of await readdir(resolve(root, directory))) {
      if (!filename.toLowerCase().endsWith(".pdf")) continue;
      sourceFileCount++;
      const source = join(directory, filename).replace(/\\/g, "/"),
        bytes = await readFile(resolve(root, source));
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (!byHash.has(hash)) {
        const code = filename
          .match(/^(CSE|IT)\s*-\s*(\d{3})/i)
          ?.slice(1)
          .join("-")
          .toUpperCase();
        const subject = subjects.find((s) => s.code === code);
        const year = filename.match(/(20\d{2})/)?.[1];
        byHash.set(hash, {
          hash,
          size: bytes.length,
          sources: [],
          originalName: filename,
          code,
          title: subject
            ? `${subject.code} · ${subject.name}`
            : filename.replace(/\.pdf$/i, ""),
          year: year ? Number(year) : undefined,
          session: filename.match(/20\d{2}[-–](?:20)?\d{2}/)?.[0],
          conflicts: [],
          catalogLinks: [],
        });
      }
      const asset = byHash.get(hash)!;
      asset.sources.push(source);
      asset.catalogLinks.push(...(links.get(source) || []));
    }
  }
  for (const a of byHash.values()) {
    if (!a.code || !subjects.some((s) => s.code === a.code))
      a.conflicts.push("Subject/offering requires verification");
    if (!a.year) a.conflicts.push("Exam year is unknown");
    for (const link of a.catalogLinks) {
      if (a.code !== link.subject)
        a.conflicts.push(
          `Catalog subject ${link.subject} points to ${a.code || "unclassified file"}`,
        );
      if (/^20\d{2}$/.test(link.label) && Number(link.label) !== a.year)
        a.conflicts.push(
          `Catalog year ${link.label} disagrees with filename year ${a.year}`,
        );
    }
    a.conflicts = [...new Set(a.conflicts)];
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceFileCount,
    assets: [...byHash.values()],
    subjects,
    branches: [
      { name: "Computer Science and Engineering", code: "CSE", slug: "cse" },
      {
        name: "Electronics and Communications Engineering",
        code: "ECE",
        slug: "ece",
      },
      { name: "Information Technology", code: "IT", slug: "it" },
      { name: "Electrical Engineering", code: "EE", slug: "electrical" },
      { name: "Mechanical Engineering", code: "ME", slug: "mechanical" },
      { name: "Civil Engineering", code: "CE", slug: "civil" },
    ],
  };
}
