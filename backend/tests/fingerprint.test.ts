import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { User, Paper, Note, ProcessingJob } from "../src/modules/models.js";
import {
  compareFingerprints,
  hamming,
  pageHash,
  pageSimilarity,
  textSimilarity,
  textSketch,
  ocrSketch,
  commonShingles,
  FINGERPRINT_VERSION,
  GRID,
  PAGE_HASH_HEX,
  type Fingerprint,
} from "../src/lib/fingerprint.js";
import { computeFingerprint } from "../src/processing/fingerprint.js";

let db: MongoMemoryReplSet, app: any;
before(async () => {
  db = await MongoMemoryReplSet.create({
    binary: {
      downloadDir: resolve(
        process.cwd(),
        process.cwd().endsWith("backend")
          ? "../node_modules/.cache/mongodb-memory-server"
          : "node_modules/.cache/mongodb-memory-server",
      ),
    },
    replSet: { count: 1 },
  });
  await mongoose.connect(db.getUri());
  const { createApp } = await import("../src/app.js");
  app = createApp();
});
after(async () => {
  await mongoose.disconnect();
  await db?.stop();
});
beforeEach(async () => {
  for (const model of [User, Paper, Note, ProcessingJob])
    await (model as any).deleteMany({});
});

/** Deterministic pseudo-random words: texts from different seeds share almost nothing. */
const lorem = (seed: number, count: number) => {
  let state = (seed * 2654435761) >>> 0 || 1;
  return Array.from({ length: count }, () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return `word${(state >>> 8) % 5000}`;
  }).join(" ");
};
/** A typed paper: the words flow over pages at the given font size. */
async function typedPdf(text: string, size = 11) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const words = text.split(" ");
  let page = pdf.addPage([595, 842]),
    y = 790,
    line = "";
  const flush = () => {
    page.drawText(line, { x: 50, y, size, font });
    line = "";
    y -= size * 1.5;
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 790;
    }
  };
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > 495) flush();
    line = line ? `${line} ${word}` : word;
  }
  if (line) flush();
  return Buffer.from(await pdf.save());
}
/** A "scan": pages of drawn shapes with no text layer. */
async function drawnPdf(seed: number, pages = 3) {
  const pdf = await PDFDocument.create();
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([595, 842]);
    for (let i = 0; i < 40; i++) {
      const k = (i * 31 + p * 17 + seed * 7) % 97;
      page.drawRectangle({
        x: 30 + ((k * 13) % 500),
        y: 40 + ((k * 29 + i * 11) % 760),
        width: 40 + (k % 120),
        height: 8 + (k % 30),
        color: rgb(
          ((k * 3) % 10) / 10,
          ((k * 5) % 10) / 10,
          ((k * 7) % 10) / 10,
        ),
      });
    }
  }
  return Buffer.from(await pdf.save());
}
async function account(role: string, trusted = false) {
  return User.create({
    email: `${role}@example.test`,
    name: `${role} fixture`,
    role,
    trusted,
    mustChangePassword: false,
    passwordHash: await bcrypt.hash("TestPassword!12345", 12),
    ...(role === "contributor"
      ? { profile: { paymentQrKey: "payment-qr/fixture.png" } }
      : {}),
  });
}
async function login(role: string) {
  const agent = request.agent(app);
  const csrf = (await agent.get("/api/auth/csrf")).body.data.token;
  await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ email: `${role}@example.test`, password: "TestPassword!12345" });
  return { agent, csrf };
}
async function offering() {
  const { University, Program, Branch, Semester, Subject, SubjectOffering } =
    await import("../src/modules/models.js");
  const s = new mongoose.Types.ObjectId().toString().slice(-6);
  const university = await University.create({ name: "U", slug: `u-${s}` });
  const program = await Program.create({
    name: "P",
    slug: `p-${s}`,
    university: university._id,
  });
  const branch = await Branch.create({
    name: "B",
    slug: `b-${s}`,
    program: program._id,
  });
  const semester = await Semester.create({
    name: "Semester 1",
    slug: `s-${s}`,
    number: 1,
    program: program._id,
  });
  const subject = await Subject.create({
    name: "Fixture Physics",
    slug: `c-${s}`,
    code: `FX-${s.toUpperCase()}`,
  });
  return SubjectOffering.create({
    subject: subject._id,
    program: program._id,
    branch: branch._id,
    semester: semester._id,
  });
}
function upload(
  who: { agent: any; csrf: string },
  role: string,
  kind: string,
  metadata: object,
  file: Buffer,
) {
  return who.agent
    .post(`/api/${role}/${kind}`)
    .set("X-CSRF-Token", who.csrf)
    .field("metadata", JSON.stringify(metadata))
    .attach("file", file, {
      filename: "fixture.pdf",
      contentType: "application/pdf",
    });
}

test("text sketches measure shared and contained text", () => {
  const a = textSketch(lorem(1, 400))!;
  const same = textSketch(lorem(1, 400))!;
  const other = textSketch(lorem(2, 400))!;
  const superset = textSketch(`${lorem(1, 400)} ${lorem(3, 400)}`)!;
  assert.equal(textSimilarity(a, same).jaccard, 1);
  assert.ok(textSimilarity(a, other).jaccard < 0.05);
  const contained = textSimilarity(a, superset);
  assert.ok(contained.aInB > 0.9, `a in superset ${contained.aInB}`);
  assert.ok(contained.bInA < 0.6, `superset in a ${contained.bInA}`);
  assert.ok(contained.jaccard > 0.4 && contained.jaccard < 0.6);
  assert.equal(textSketch("too short"), null);
});

test("phrases shared across the library do not count as shared content", () => {
  // Every paper of one university starts with the same printed instructions.
  const header =
    "Barkatullah University Institute of Technology end semester examination time three hours maximum marks sixty note attempt any five questions all questions carry equal marks draw neat diagrams wherever necessary assume suitable data if required";
  const papers = Array.from({ length: 12 }, (_, i) =>
    ocrSketch(`${header} ${lorem(100 + i, 120)}`),
  );
  const common = commonShingles(papers);
  assert.ok(common.size > 20, "the header's word pairs are recognised");
  const [a, b] = papers;
  const naive = textSimilarity(a!, b!);
  const informed = textSimilarity(a!, b!, common);
  assert.ok(naive.jaccard > 0.08, `header alone scores ${naive.jaccard}`);
  assert.ok(informed.jaccard < 0.02, `without the header ${informed.jaccard}`);
  // Two scans of the same paper still match with the header removed.
  const same = textSimilarity(
    a!,
    ocrSketch(`${header} ${lorem(100, 120)}`)!,
    common,
  );
  assert.equal(same.jaccard, 1);
});

test("page hashes skip blank pages and tolerate small differences", () => {
  const flat = new Array(GRID * GRID).fill(200);
  assert.equal(pageHash(flat), "");
  const cells = Array.from({ length: GRID * GRID }, (_, i) => (i * 37) % 251);
  const hash = pageHash(cells);
  assert.equal(hash.length, PAGE_HASH_HEX);
  const nudged = cells.map((v) => Math.min(255, v + 3));
  assert.equal(hamming(hash, pageHash(nudged)), 0);
  const different = pageHash(cells.map((_, i) => (i * 101) % 251));
  assert.ok(hamming(hash, different) > 100);
  const similarity = pageSimilarity([hash, "", hash], [different, hash])!;
  assert.equal(similarity.matched, 1);
  assert.equal(similarity.aInB, 0.5);
});

test("the worker fingerprints typed and scanned PDFs so copies are recognised", async () => {
  const typed = await computeFingerprint(await typedPdf(lorem(5, 600)));
  assert.ok(typed.text, "typed PDF has a text sketch");
  assert.ok(typed.pages.length >= 2);
  // Same words, bigger font: different bytes, different page count, same content.
  const relaid = await computeFingerprint(await typedPdf(lorem(5, 600), 16));
  assert.notEqual(relaid.pages.length, typed.pages.length);
  assert.ok(compareFingerprints(relaid, typed).score > 0.98);
  const otherText = await computeFingerprint(await typedPdf(lorem(6, 600)));
  assert.ok(compareFingerprints(otherText, typed).score < 0.1);
  // Half of the text copied into a longer document: contained, not identical.
  const partial = await computeFingerprint(
    await typedPdf(`${lorem(5, 300)} ${lorem(7, 300)}`),
  );
  const contained = compareFingerprints(partial, typed);
  assert.ok(
    contained.score > 0.4 && contained.score < 0.7,
    String(contained.score),
  );

  const scan = await computeFingerprint(await drawnPdf(1));
  assert.equal(scan.text, null);
  assert.equal(scan.pages.filter(Boolean).length, 3);
  const resaved = await PDFDocument.load(await drawnPdf(1));
  resaved.setTitle("another export");
  const copy = await computeFingerprint(
    Buffer.from(await resaved.save({ useObjectStreams: false })),
  );
  assert.deepEqual(compareFingerprints(copy, scan), {
    score: 1,
    basis: "pages",
    matchedPages: 3,
  });
  const otherScan = await computeFingerprint(await drawnPdf(2));
  assert.equal(compareFingerprints(otherScan, scan).score, 0);
});

test("uploads whose content is already in the library are refused, admins can override", async () => {
  const { runNextJob } = await import("../src/processing/jobs.js");
  await account("contributor");
  await account("admin");
  const contributor = await login("contributor");
  const admin = await login("admin");
  const o = await offering();
  const original = await typedPdf(lorem(11, 500));
  const fingerprint = await computeFingerprint(original);
  const metadata = {
    title: "Physics 2024 end sem",
    offerings: [String(o._id)],
    year: 2024,
    fingerprint,
  };
  const first = await upload(
    contributor,
    "contributor",
    "papers",
    metadata,
    original,
  );
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const stored: any = await Paper.findById(first.body.data._id).lean();
  assert.equal(stored.fingerprint.by, "browser");
  assert.equal(stored.fingerprint.text.shingles, fingerprint.text!.shingles);
  // The queue recomputes it from the stored file and gets the same answer.
  while (await runNextJob());
  const recomputed: any = await Paper.findById(first.body.data._id).lean();
  assert.equal(recomputed.fingerprint.by, "server");
  assert.deepEqual(recomputed.fingerprint.pages, fingerprint.pages);

  // A re-export of the same paper (new bytes, same words) is a copy.
  const copyBytes = await typedPdf(lorem(11, 500), 13);
  const copyFingerprint = await computeFingerprint(copyBytes);
  const check = await contributor.agent
    .post("/api/contributor/duplicates/check")
    .set("X-CSRF-Token", contributor.csrf)
    .send({ kind: "papers", fingerprint: copyFingerprint });
  assert.equal(check.status, 200);
  assert.equal(check.body.data.matches[0].item.title, "Physics 2024 end sem");
  assert.ok(check.body.data.matches[0].score >= check.body.data.threshold);
  const refused = await upload(
    contributor,
    "contributor",
    "papers",
    {
      ...metadata,
      title: "Physics 2024 (again)",
      fingerprint: copyFingerprint,
    },
    copyBytes,
  );
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, "DUPLICATE_CONTENT");
  assert.match(refused.body.error.message, /Physics 2024 end sem/);
  assert.equal(
    refused.body.error.details.matches[0].item.title,
    "Physics 2024 end sem",
  );
  assert.equal(
    await Paper.countDocuments(),
    1,
    "the refused copy was not stored",
  );
  // Contributors cannot override; admins can.
  const stillRefused = await upload(
    contributor,
    "contributor",
    "papers",
    { ...metadata, fingerprint: copyFingerprint, allowDuplicate: true },
    copyBytes,
  );
  assert.equal(stillRefused.status, 409);
  const allowed = await upload(
    admin,
    "admin",
    "papers",
    {
      ...metadata,
      title: "Physics 2024 better scan",
      fingerprint: copyFingerprint,
      allowDuplicate: true,
    },
    copyBytes,
  );
  assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
  // A different paper passes without comment.
  const other = await typedPdf(lorem(12, 500));
  const ok = await upload(
    contributor,
    "contributor",
    "papers",
    {
      ...metadata,
      title: "Chemistry 2024",
      fingerprint: await computeFingerprint(other),
    },
    other,
  );
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  // Bulk rows are checked one by one.
  const bulk = await contributor.agent
    .post("/api/contributor/papers/bulk")
    .set("X-CSRF-Token", contributor.csrf)
    .field(
      "metadata",
      JSON.stringify([
        {
          title: "Bulk copy",
          offerings: [String(o._id)],
          fingerprint: copyFingerprint,
        },
      ]),
    )
    .attach("files", await typedPdf(lorem(11, 500), 9), {
      filename: "bulk.pdf",
      contentType: "application/pdf",
    });
  assert.equal(bulk.status, 207);
  assert.match(bulk.body.data[0].error, /already in the library/);

  // The admin report lists the pair the override created.
  while (await runNextJob());
  const report = await admin.agent.get("/api/admin/duplicates");
  assert.equal(report.status, 200);
  assert.equal(report.body.data.pairs.length, 1);
  assert.equal(report.body.data.pairs[0].kind, "papers");
  assert.ok(report.body.data.pairs[0].similarity >= 80);
  const titles = [
    report.body.data.pairs[0].a.title,
    report.body.data.pairs[0].b.title,
  ].sort();
  assert.deepEqual(titles, [
    "Physics 2024 better scan",
    "Physics 2024 end sem",
  ]);
  assert.deepEqual(report.body.data.unscanned, { papers: 0, notes: 0 });
  // Scanning queues work only for items that still lack a fingerprint.
  await Paper.updateOne(
    { title: "Chemistry 2024" },
    { $unset: { fingerprint: "" } },
  );
  const scan = await admin.agent
    .post("/api/admin/duplicates/scan")
    .set("X-CSRF-Token", admin.csrf)
    .send({});
  assert.equal(scan.status, 200);
  assert.equal(scan.body.data.queued, 1);
  // Public and staff lists do not carry the fingerprint around.
  const list = await contributor.agent.get("/api/contributor/papers");
  assert.equal(list.body.data[0].fingerprint, undefined);
  const pub = await request(app).get("/api/papers");
  for (const item of pub.body.data) assert.equal(item.fingerprint, undefined);
});

test("two different scans of the same paper are recognised through OCR", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const sharp = (await import("sharp")).default;
  // A "scan": the typed page rendered to an image and wrapped in a PDF with no text.
  const questions = Array.from(
    { length: 14 },
    (_, i) =>
      `Q${i + 1}. Explain the ${["working", "construction", "applications", "limitations"][i % 4]} of a ${["diode", "transistor", "rectifier", "amplifier", "oscillator", "transformer", "capacitor"][i % 7]} with a neat labelled diagram and derive the expression for its ${["gain", "efficiency", "ripple factor", "time constant"][i % 4]}.`,
  ).join(" ");
  const typed = await typedPdf(questions, 13);
  const doc = await getDocument({ data: new Uint8Array(typed), verbosity: 0 })
    .promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2000 / 842 });
  const factory = doc.canvasFactory as any;
  const surface = factory.create(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  await page.render({ canvasContext: surface.context, viewport } as any)
    .promise;
  const photo: Buffer = surface.canvas.toBuffer("image/png");
  factory.destroy(surface);
  await doc.loadingTask.destroy();
  const scanPdf = async (image: Buffer) => {
    const pdf = await PDFDocument.create();
    const embedded =
      image[0] === 0x89 ? await pdf.embedPng(image) : await pdf.embedJpg(image);
    pdf
      .addPage([595, 842])
      .drawImage(embedded, { x: 0, y: 0, width: 595, height: 842 });
    return Buffer.from(await pdf.save());
  };
  const scanA = await scanPdf(photo);
  // The second student's scan: tilted, cropped, darker, blurrier, re-compressed.
  const meta = await sharp(photo).metadata();
  const scanB = await scanPdf(
    await sharp(photo)
      .extract({
        left: Math.round(meta.width! * 0.03),
        top: Math.round(meta.height! * 0.02),
        width: Math.round(meta.width! * 0.94),
        height: Math.round(meta.height! * 0.95),
      })
      .rotate(1.4, { background: "#d0d0d0" })
      .resize(Math.round(meta.width! * 0.8))
      .modulate({ brightness: 0.88 })
      .blur(0.6)
      .jpeg({ quality: 60 })
      .toBuffer(),
  );
  const a = await computeFingerprint(scanA, { ocr: true });
  const b = await computeFingerprint(scanB, { ocr: true });
  assert.equal(a.text, null, "a scan has no text layer");
  assert.ok(a.ocr && a.ocr.shingles > 50, "OCR read the scan");
  assert.equal(compareFingerprints(b, a).basis, "ocr");
  assert.ok(
    compareFingerprints(b, a).score >= 0.8,
    `second scan scores ${compareFingerprints(b, a).score}`,
  );
  // A scan also matches a typed copy of the same paper, through the layer's words.
  const typedPrint = await computeFingerprint(typed, { ocr: true });
  assert.ok(compareFingerprints(a, typedPrint).score >= 0.8);
  // A different paper of the same kind stays far below the warning level.
  const other = await computeFingerprint(await typedPdf(lorem(31, 200), 13), {
    ocr: true,
  });
  assert.ok(compareFingerprints(a, other).score < 0.3);
  // Without OCR the worker leaves the sketch empty instead of guessing.
  const quick = await computeFingerprint(scanA, { ocr: false });
  assert.equal(quick.ocr, null);
});

test("Markdown notes are compared on their text", async () => {
  await account("admin");
  const admin = await login("admin");
  const o = await offering();
  const markdown = `# Unit 1\n\n${lorem(21, 300)}`;
  const first = await admin.agent
    .post("/api/admin/notes")
    .set("X-CSRF-Token", admin.csrf)
    .send({
      title: "Unit 1 notes",
      offerings: [String(o._id)],
      format: "markdown",
      markdown,
    });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const stored: any = await Note.findById(first.body.data._id).lean();
  assert.equal(stored.fingerprint.by, "server");
  assert.ok(stored.fingerprint.text.shingles > 100);
  const copy = await admin.agent
    .post("/api/admin/notes")
    .set("X-CSRF-Token", admin.csrf)
    .send({
      title: "Unit 1 notes (copy)",
      offerings: [String(o._id)],
      format: "markdown",
      markdown: `${markdown}\n\nSmall addition at the end.`,
    });
  assert.equal(copy.status, 409);
  assert.equal(copy.body.error.code, "DUPLICATE_CONTENT");
  const fresh = await admin.agent
    .post("/api/admin/notes")
    .set("X-CSRF-Token", admin.csrf)
    .send({
      title: "Unit 2 notes",
      offerings: [String(o._id)],
      format: "markdown",
      markdown: `# Unit 2\n\n${lorem(22, 300)}`,
    });
  assert.equal(fresh.status, 201);
  // Editing Unit 2 into a copy of Unit 1 is refused as well.
  const edited = await admin.agent
    .patch(`/api/admin/notes/${fresh.body.data._id}`)
    .set("X-CSRF-Token", admin.csrf)
    .send({ markdown });
  assert.equal(edited.status, 409);
  const fp: Fingerprint = {
    v: FINGERPRINT_VERSION,
    pages: [],
    text: textSketch(markdown),
    ocr: ocrSketch(markdown),
  };
  const check = await admin.agent
    .post("/api/admin/duplicates/check")
    .set("X-CSRF-Token", admin.csrf)
    .send({ kind: "notes", fingerprint: fp, exclude: first.body.data._id });
  assert.equal(check.body.data.matches.length, 0);
});
