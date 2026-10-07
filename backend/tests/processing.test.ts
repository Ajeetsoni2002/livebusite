import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  User,
  Paper,
  Note,
  FileAsset,
  ProcessingJob,
  Setting,
} from "../src/modules/models.js";

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
  for (const model of [User, Paper, Note, ProcessingJob, Setting])
    await (model as any).deleteMany({});
});

async function account(role: string, trusted = false) {
  return User.create({
    email: `${role}@example.test`,
    name: `${role} fixture`,
    role,
    trusted,
    mustChangePassword: false,
    passwordHash: await bcrypt.hash("TestPassword!12345", 12),
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
    name: "Fixture Chemistry",
    slug: `c-${s}`,
    code: `FX-${s.toUpperCase()}`,
  });
  return {
    code: subject.code,
    offering: await SubjectOffering.create({
      subject: subject._id,
      program: program._id,
      branch: branch._id,
      semester: semester._id,
    }),
  };
}
async function samplePdf(text: string, rotate = false) {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]).drawText(text, { x: 60, y: 760, size: 14 });
  const landscape = pdf.addPage([842, 595]);
  landscape.drawText("Question 2", { x: 60, y: 520, size: 14 });
  if (rotate) landscape.setRotation(degrees(90));
  return Buffer.from(await pdf.save());
}
async function pageTexts(bytes: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 })
    .promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++)
    pages.push(
      (await (await doc.getPage(n)).getTextContent()).items
        .map((item: any) => item.str)
        .join(" "),
    );
  await doc.loadingTask.destroy();
  return pages;
}
async function publicPdf(id: string) {
  const preview = await request(app).get(`/api/papers/${id}/preview`);
  assert.equal(preview.status, 302);
  return (await request(app).get(preview.headers.location).buffer(true)).body;
}
async function upload(
  who: { agent: any; csrf: string },
  role: string,
  offeringId: unknown,
  file: Buffer,
  status?: string,
) {
  return who.agent
    .post(`/api/${role}/papers`)
    .set("X-CSRF-Token", who.csrf)
    .field(
      "metadata",
      JSON.stringify({
        title: "Watermark fixture",
        offerings: [String(offeringId)],
        year: 2025,
        ...(status ? { status } : {}),
      }),
    )
    .attach("file", file, {
      filename: "fixture.pdf",
      contentType: "application/pdf",
    });
}

test("watermark text uses only the first subject code and drops an empty placeholder", async () => {
  const { renderWatermarkText } =
    await import("../src/processing/watermark.js");
  assert.equal(
    renderWatermarkText("{subjectCode} | Ajeet Soni", "CSE-703"),
    "CSE-703 | Ajeet Soni",
  );
  assert.equal(
    renderWatermarkText("{subjectCode} | Ajeet Soni", ""),
    "Ajeet Soni",
  );
});

test("new uploads stay private until every page is watermarked; the original is kept", async () => {
  const { runNextJob } = await import("../src/processing/jobs.js");
  await account("contributor", true);
  const contributor = await login("contributor");
  const { offering: o, code } = await offering();
  const file = await samplePdf("Question 1", true);
  const created = await upload(contributor, "contributor", o._id, file);
  assert.equal(created.status, 201);
  const id = created.body.data._id;
  assert.equal(created.body.data.status, "published");
  // Published but held: the public cannot read the unmarked file.
  const held = await request(app).get(`/api/papers/${id}/preview`);
  assert.equal(held.status, 409);
  assert.equal(held.body.error.code, "PREPARING");
  const own = await contributor.agent.get(
    `/api/contributor/papers/${id}/processing`,
  );
  assert.equal(own.body.data.watermark.status, "queued");

  assert.equal(await runNextJob(), true);
  assert.equal(await runNextJob(), false);
  const item: any = await Paper.findById(id).lean();
  assert.equal(item.watermark.status, "done");
  assert.equal(item.watermark.hold, false);
  assert.notEqual(String(item.asset), String(item.files.original));
  const original: any = await FileAsset.findById(item.files.original);
  assert.equal(original.hash, createHash("sha256").update(file).digest("hex"));

  const pages = await pageTexts(await publicPdf(id));
  assert.equal(pages.length, 2);
  for (const text of pages)
    assert.match(text, new RegExp(`${code} \\| Ajeet Soni`));
  assert.match(pages[0], /Question 1/);
  assert.match(pages[1], /Question 2/);
  const listed = (await request(app).get("/api/papers")).body.data[0];
  assert.equal("files" in listed || "watermark" in listed, false);
});

test("PDFs that already carry the name are skipped and served as uploaded", async () => {
  const { runNextJob } = await import("../src/processing/jobs.js");
  await account("admin");
  const admin = await login("admin");
  const { offering: o } = await offering();
  const created = await upload(
    admin,
    "admin",
    o._id,
    await samplePdf("BE-102 - Ajeet Soni"),
    "published",
  );
  await runNextJob();
  const item: any = await Paper.findById(created.body.data._id).lean();
  assert.equal(item.watermark.status, "skipped");
  assert.equal(item.watermark.reason, "already-watermarked");
  assert.equal(String(item.asset), String(item.files.original));
  assert.equal(
    (await request(app).get(`/api/papers/${item._id}/preview`)).status,
    302,
  );
});

test("watermark settings are admin-only; re-apply re-marks outdated items in place", async () => {
  const { runNextJob } = await import("../src/processing/jobs.js");
  await account("admin");
  await account("contributor");
  const admin = await login("admin");
  const contributor = await login("contributor");
  const { offering: o, code } = await offering();
  const created = await upload(
    admin,
    "admin",
    o._id,
    await samplePdf("Q1"),
    "published",
  );
  await runNextJob();
  assert.equal(
    (await contributor.agent.get("/api/admin/settings/watermark")).status,
    403,
  );
  const current = (await admin.agent.get("/api/admin/settings/watermark")).body
    .data;
  const bad = await admin.agent
    .put("/api/admin/settings/watermark")
    .set("X-CSRF-Token", admin.csrf)
    .send({ ...current.settings, template: "₹ {subjectCode}" });
  assert.equal(bad.status, 400);
  const saved = await admin.agent
    .put("/api/admin/settings/watermark")
    .set("X-CSRF-Token", admin.csrf)
    .send({
      ...current.settings,
      template: "{subjectCode} BUIT",
      tiled: false,
    });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.revision, current.revision + 1);
  const apply = (body: object) =>
    admin.agent
      .post("/api/admin/watermark/apply")
      .set("X-CSRF-Token", admin.csrf)
      .send(body);
  assert.equal(
    (await apply({ scope: "all", dryRun: true })).body.data.count,
    1,
  );
  const queued = (await apply({ scope: "all" })).body.data;
  assert.equal(queued.queued, 1);
  // Still public while re-marking: the previous watermarked copy keeps serving.
  assert.equal(
    (await request(app).get(`/api/papers/${created.body.data._id}/preview`))
      .status,
    302,
  );
  await runNextJob();
  const pages = await pageTexts(await publicPdf(created.body.data._id));
  assert.match(pages[0], new RegExp(`${code} BUIT`));
  assert.doesNotMatch(pages[0], /Ajeet Soni/);
  const summary = await admin.agent.get(
    `/api/admin/jobs/summary?batch=${queued.batch}`,
  );
  assert.deepEqual(summary.body.data.counts, { done: 1 });
  assert.equal(
    (await apply({ scope: "all", dryRun: true })).body.data.count,
    0,
  );
});

test("a job abandoned by a stopped instance is picked up again after its lease", async () => {
  const { runNextJob } = await import("../src/processing/jobs.js");
  const { savePdf } = await import("../src/storage/index.js");
  const asset = await savePdf({
    buffer: await samplePdf("Orphan"),
    mimetype: "application/pdf",
    originalname: "orphan.pdf",
  });
  const paper = await Paper.create({
    title: "Orphan",
    slug: "orphan",
    status: "published",
    asset: asset._id,
    files: { original: asset._id },
    watermark: { status: "running", hold: true },
  });
  await ProcessingJob.create({
    type: "watermark",
    contentType: "papers",
    content: paper._id,
    status: "running",
    attempts: 1,
    leaseUntil: new Date(Date.now() - 1000),
  });
  assert.equal(await runNextJob(), true);
  const item: any = await Paper.findById(paper._id).lean();
  assert.equal(item.watermark.status, "done");
  assert.equal(item.watermark.hold, false);
});

const meta = {
  pages: 3,
  sourcePages: 2,
  split: [2],
  enhanced: [1],
  preset: "grayscale",
  mode: "needed",
};

test("a contributor can upload a processed version and choose it; originals stay private", async () => {
  const { runNextJob } = await import("../src/processing/jobs.js");
  await account("contributor");
  await account("admin");
  const contributor = await login("contributor");
  const admin = await login("admin");
  const { offering: o, code } = await offering();
  const original = await samplePdf("Original scan");
  const processed = await samplePdf("Cleaned scan");
  const created = await contributor.agent
    .post("/api/contributor/papers")
    .set("X-CSRF-Token", contributor.csrf)
    .field(
      "metadata",
      JSON.stringify({
        title: "Processed fixture",
        offerings: [String(o._id)],
        useVersion: "processed",
        processedMeta: meta,
      }),
    )
    .attach("file", original, {
      filename: "o.pdf",
      contentType: "application/pdf",
    })
    .attach("processed", processed, {
      filename: "p.pdf",
      contentType: "application/pdf",
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.data._id;
  assert.equal(created.body.data.activeVersion, "processed");
  await runNextJob();
  // The owner and admins can read both versions; the public and others cannot.
  for (const version of ["original", "processed"]) {
    const own = await contributor.agent
      .get(`/api/contributor/papers/${id}/source/${version}`)
      .buffer(true);
    assert.equal(own.status, 200);
    assert.equal(own.headers["content-type"], "application/pdf");
  }
  assert.equal(
    (await request(app).get(`/api/contributor/papers/${id}/source/original`))
      .status,
    401,
  );
  assert.equal(
    (await admin.agent.get(`/api/admin/papers/${id}/source/original`)).status,
    200,
  );
  assert.equal(
    (await admin.agent.get(`/api/admin/papers/${id}/source/other`)).status,
    400,
  );
  // Approve, then the public file is the watermarked processed version.
  await admin.agent
    .post(`/api/admin/papers/${id}/approve`)
    .set("X-CSRF-Token", admin.csrf)
    .send({});
  let pages = await pageTexts(await publicPdf(id));
  assert.match(pages[0], /Cleaned scan/);
  assert.match(pages[0], new RegExp(`${code} \| Ajeet Soni`));
  // Admin reverts to the original: published stays public meanwhile, then swaps.
  const revert = await admin.agent
    .post(`/api/admin/papers/${id}/activate`)
    .set("X-CSRF-Token", admin.csrf)
    .send({ version: "original" });
  assert.equal(revert.status, 200);
  assert.equal(
    (await request(app).get(`/api/papers/${id}/preview`)).status,
    302,
  );
  await runNextJob();
  pages = await pageTexts(await publicPdf(id));
  assert.match(pages[0], /Original scan/);
  // Switching back reuses the cached watermarked copy.
  await admin.agent
    .post(`/api/admin/papers/${id}/activate`)
    .set("X-CSRF-Token", admin.csrf)
    .send({ version: "processed" });
  const before = await FileAsset.countDocuments();
  await runNextJob();
  assert.equal(await FileAsset.countDocuments(), before);
  assert.match((await pageTexts(await publicPdf(id)))[0], /Cleaned scan/);
});

test("processed uploads are validated and limited to the owner's editable items", async () => {
  await account("contributor");
  await account("admin");
  const contributor = await login("contributor");
  const admin = await login("admin");
  const { offering: o } = await offering();
  const created = await upload(
    admin,
    "admin",
    o._id,
    await samplePdf("Admin item"),
    "published",
  );
  const id = created.body.data._id;
  const send = (who: any, role: string, body: object) =>
    who.agent
      .post(`/api/${role}/papers/${id}/processed`)
      .set("X-CSRF-Token", who.csrf)
      .field("metadata", JSON.stringify(body))
      .attach("processed", Buffer.from("not a pdf"), {
        filename: "p.pdf",
        contentType: "application/pdf",
      });
  assert.equal(
    (await send(contributor, "contributor", { processedMeta: meta })).status,
    404,
  );
  assert.equal(
    (await send(admin, "admin", { processedMeta: { pages: 0 } })).status,
    400,
  );
  const good = await admin.agent
    .post(`/api/admin/papers/${id}/processed`)
    .set("X-CSRF-Token", admin.csrf)
    .field("metadata", JSON.stringify({ processedMeta: meta, activate: false }))
    .attach("processed", await samplePdf("Admin processed"), {
      filename: "p.pdf",
      contentType: "application/pdf",
    });
  assert.equal(good.status, 200);
  assert.equal(good.body.data.activeVersion, "original");
  const status = (await admin.agent.get(`/api/admin/papers/${id}/processing`))
    .body.data;
  assert.equal(status.hasProcessed, true);
  assert.equal(status.processedMeta.split[0], 2);
});

test("missing thumbnail objects return 404 and the repair job recreates them", async () => {
  const { runNextJob } = await import("../src/processing/jobs.js");
  const { savePdf, storage } = await import("../src/storage/index.js");
  await account("admin");
  const admin = await login("admin");
  const asset: any = await savePdf({
    buffer: await samplePdf("Thumb fixture"),
    mimetype: "application/pdf",
    originalname: "t.pdf",
  });
  assert.ok(asset.thumbnailKey);
  const paper = await Paper.create({
    title: "Thumb",
    slug: "thumb",
    status: "published",
    asset: asset._id,
  });
  await storage.delete(asset.thumbnailKey);
  assert.equal(
    (await request(app).get(`/api/papers/${paper._id}/thumbnail`)).status,
    404,
  );
  assert.equal(
    (await FileAsset.findById(asset._id).lean<any>()).thumbnailKey,
    undefined,
  );
  const repair = (dryRun: boolean) =>
    admin.agent
      .post("/api/admin/thumbnails/repair")
      .set("X-CSRF-Token", admin.csrf)
      .send({ dryRun });
  assert.equal((await repair(true)).body.data.count, 1);
  assert.equal((await repair(false)).body.data.queued, 1);
  await runNextJob();
  assert.equal(
    (await request(app).get(`/api/papers/${paper._id}/thumbnail`)).status,
    200,
  );
  assert.equal((await repair(true)).body.data.count, 0);
});

test("students can request a contributor account; admins approve or reject it", async () => {
  const { ContributorRequest } = await import("../src/modules/models.js");
  await ContributorRequest.deleteMany({});
  await account("admin");
  await account("contributor");
  const admin = await login("admin");
  const contributor = await login("contributor");
  const form = {
    name: "Riya Sharma",
    email: "Riya@Example.test",
    phone: "+91 98765 43210",
    branch: "CSE",
    semester: 3,
    message: "I have 2023 and 2024 end-semester papers for CSE semester 3.",
    consent: true,
  };
  const send = (body: object) =>
    request(app).post("/api/contributor-requests").send(body);
  assert.equal((await send({ ...form, consent: false })).status, 400);
  assert.equal((await send({ ...form, message: "too short" })).status, 400);
  assert.equal((await send(form)).status, 201);
  // A second request from the same email updates the open one.
  assert.equal((await send({ ...form, semester: 4 })).status, 201);
  // Bots filling the hidden field get the same answer but nothing is stored.
  assert.equal(
    (await send({ ...form, email: "bot@example.test", website: "x" })).status,
    201,
  );
  // An existing account gets the same public answer (no account probing).
  const existing = await send({ ...form, email: "contributor@example.test" });
  assert.equal(existing.status, 201);
  assert.deepEqual(existing.body.data, { received: true });

  assert.equal(
    (await contributor.agent.get("/api/admin/contributor-requests")).status,
    403,
  );
  assert.equal(
    (await request(app).get("/api/admin/contributor-requests")).status,
    401,
  );
  const list = (await admin.agent.get("/api/admin/contributor-requests")).body
    .data;
  assert.equal(list.length, 2);
  const riya = list.find((r: any) => r.email === "riya@example.test");
  assert.equal(riya.semester, 4);
  const taken = list.find((r: any) => r.email === "contributor@example.test");
  assert.equal(taken.existingAccount, true);

  const approved = await admin.agent
    .post(`/api/admin/contributor-requests/${riya._id}/approve`)
    .set("X-CSRF-Token", admin.csrf)
    .send({});
  assert.equal(approved.status, 200);
  const password = approved.body.data.temporaryPassword;
  assert.ok(password.length >= 12);
  const user: any = await User.findOne({ email: "riya@example.test" }).lean();
  assert.equal(user.role, "contributor");
  assert.equal(user.mustChangePassword, true);
  const fresh = request.agent(app);
  const csrf = (await fresh.get("/api/auth/csrf")).body.data.token;
  const signIn = await fresh
    .post("/api/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ email: "riya@example.test", password });
  assert.equal(signIn.status, 200);
  assert.equal(
    (
      await admin.agent
        .post(`/api/admin/contributor-requests/${riya._id}/approve`)
        .set("X-CSRF-Token", admin.csrf)
        .send({})
    ).status,
    404,
  );
  const conflict = await admin.agent
    .post(`/api/admin/contributor-requests/${taken._id}/approve`)
    .set("X-CSRF-Token", admin.csrf)
    .send({});
  assert.equal(conflict.status, 409);
  const rejected = await admin.agent
    .post(`/api/admin/contributor-requests/${taken._id}/reject`)
    .set("X-CSRF-Token", admin.csrf)
    .send({ note: "Already has an account" });
  assert.equal(rejected.body.data.status, "rejected");
  assert.equal(
    (await admin.agent.get("/api/admin/contributor-requests")).body.data.length,
    0,
  );
});
