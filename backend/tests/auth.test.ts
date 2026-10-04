import { test, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { resolve } from "node:path";
import { User, Session, Paper, Note } from "../src/modules/models.js";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
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
  await User.deleteMany({});
  await Session.deleteMany({});
  await Paper.deleteMany({});
  await Note.deleteMany({});
});
async function account(role = "contributor", mustChangePassword = false) {
  return User.create({
    email: `${role}@example.test`,
    name: "Test account",
    role,
    passwordHash: await bcrypt.hash("TestPassword!12345", 12),
    mustChangePassword,
  });
}
async function login(role = "contributor") {
  const agent = request.agent(app);
  const csrf = (await agent.get("/api/auth/csrf")).body.data.token;
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ email: `${role}@example.test`, password: "TestPassword!12345" });
  return { agent, csrf, response };
}
test("no public registration; login requires CSRF and correct credentials", async () => {
  await account();
  assert.equal((await request(app).post("/api/auth/register")).status, 404);
  assert.equal(
    (
      await request(app).post("/api/auth/login").send({
        email: "contributor@example.test",
        password: "TestPassword!12345",
      })
    ).status,
    403,
  );
  const { agent, response } = await login();
  assert.equal(response.status, 200);
  assert.equal((await agent.get("/api/auth/me")).body.data.role, "contributor");
});
test("forced password change blocks workspace and logout revokes session", async () => {
  await account("contributor", true);
  const { agent, csrf } = await login();
  assert.equal((await agent.get("/api/contributor/uploads")).status, 403);
  assert.equal(
    (
      await agent
        .post("/api/auth/change-password")
        .set("X-CSRF-Token", csrf)
        .send({
          currentPassword: "TestPassword!12345",
          newPassword: "NewPassword!67890",
        })
    ).status,
    200,
  );
  assert.equal(
    (await agent.post("/api/auth/logout").set("X-CSRF-Token", csrf)).status,
    200,
  );
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});
test("refresh rotates tokens and replay revokes the entire session family", async () => {
  await account();
  const { agent, csrf, response } = await login();
  const initialCookies = [
    ...(response.headers["set-cookie"] as unknown as string[]).map(
      (c: string) => c.split(";")[0],
    ),
    `csrf=${csrf}`,
  ];
  assert.equal(
    (await agent.post("/api/auth/refresh").set("X-CSRF-Token", csrf)).status,
    200,
  );
  const replay = await request(app)
    .post("/api/auth/refresh")
    .set("Cookie", initialCookies)
    .set("X-CSRF-Token", csrf);
  assert.equal(replay.status, 401);
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});
test("deactivated accounts lose existing access immediately", async () => {
  const user = await account();
  const { agent } = await login();
  await User.updateOne({ _id: user._id }, { $set: { active: false } });
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});
test("public preview hides pending papers and supports signed byte-range reads", async () => {
  const { savePdf } = await import("../src/storage/index.js");
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const asset = await savePdf({
    buffer: Buffer.from(await pdf.save()),
    mimetype: "application/pdf",
    originalname: "test.pdf",
  });
  const paper = await Paper.create({
    title: "Test fixture only",
    slug: "test-only",
    asset: asset._id,
    status: "pending",
  });
  assert.equal(
    (await request(app).get(`/api/papers/${paper._id}/preview`)).status,
    404,
  );
  paper.status = "published";
  await paper.save();
  const preview = await request(app).get(`/api/papers/${paper._id}/preview`);
  assert.equal(preview.status, 302);
  const range = await request(app)
    .get(preview.headers.location)
    .set("Range", "bytes=0-7");
  assert.equal(range.status, 206);
  assert.equal(range.headers["content-length"], "8");
  const full = await request(app).get(preview.headers.location).buffer(true);
  assert.equal(full.status, 200);
  assert.equal(Number(full.headers["content-length"]), asset.size);
  assert.equal(full.body.length, asset.size);
  const key = "12345678-1234-4234-8234-123456789abc";
  await request(app)
    .post(`/api/papers/${paper._id}/download`)
    .set("Idempotency-Key", key);
  await request(app)
    .post(`/api/papers/${paper._id}/download`)
    .set("Idempotency-Key", key);
  assert.equal((await Paper.findById(paper._id)).downloads, 1);
});

test("uploads generate first-page thumbnails with the same visibility as the PDF", async () => {
  const { savePdf, storage } = await import("../src/storage/index.js");
  const pdf = await PDFDocument.create();
  pdf
    .addPage([300, 400])
    .drawRectangle({ width: 300, height: 400, color: rgb(1, 0, 0) });
  pdf
    .addPage([300, 400])
    .drawRectangle({ width: 300, height: 400, color: rgb(0, 0, 1) });
  const asset = await savePdf({
    buffer: Buffer.from(await pdf.save()),
    mimetype: "application/pdf",
    originalname: "thumbnail-fixture.pdf",
  });
  assert.ok(asset.thumbnailKey, "a valid upload should have a thumbnail");
  const paper = await Paper.create({
    title: "Thumbnail fixture",
    slug: "thumbnail-fixture",
    asset: asset._id,
    status: "pending",
  });
  const path = `/api/papers/${paper._id}/thumbnail`;
  assert.equal((await request(app).get(path)).status, 404);
  const listing = await request(app).get(`/api/papers/${paper._id}`);
  assert.equal(listing.status, 404);
  await account("admin");
  const { agent } = await login("admin");
  assert.equal((await agent.get(path)).status, 200);
  paper.status = "published";
  await paper.save();
  const publicItem = (await request(app).get(`/api/papers/${paper._id}`)).body
    .data;
  assert.equal(publicItem.hasThumbnail, true);
  assert.equal(
    "asset" in publicItem,
    false,
    "public metadata must not expose storage keys",
  );
  const response = await request(app).get(path).buffer(true);
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /image\/webp/);
  assert.match(response.headers["cache-control"], /no-store/);
  const { data, info } = await sharp(response.body)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(info.width <= 480 && info.height <= 480);
  const middle =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
    info.channels;
  assert.ok(
    data[middle] > 200 && data[middle + 2] < 40,
    "thumbnail must show the red first page, not the blue second page",
  );
  assert.equal((await Paper.findById(paper._id)).downloads, 0);
  paper.deletedAt = new Date();
  await paper.save();
  assert.equal((await request(app).get(path)).status, 404);
  await storage.delete(asset.key);
  await storage.delete(asset.thumbnailKey);
});

test("thumbnail storage failures never reject or delete a valid PDF upload", async () => {
  const { savePdf, storage } = await import("../src/storage/index.js");
  const pdf = await PDFDocument.create();
  pdf.setTitle("Thumbnail storage failure fixture");
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const originalPut = storage.put.bind(storage);
  const failingStorage = mock.method(
    storage,
    "put",
    async (key, buffer, mime) => {
      if (mime === "image/webp")
        throw new Error("Thumbnail object storage unavailable");
      return originalPut(key, buffer, mime);
    },
  );
  let asset: any;
  try {
    asset = await savePdf({
      buffer: bytes,
      mimetype: "application/pdf",
      originalname: "thumbnail-storage-failure.pdf",
    });
    assert.ok(asset._id);
    assert.equal(Boolean(asset.thumbnailKey), false);
    assert.equal((await storage.head(asset.key)).size, bytes.length);
    const paper = await Paper.create({
      title: "Thumbnail storage failure fixture",
      slug: "thumbnail-storage-failure",
      status: "published",
      asset: asset._id,
    });
    assert.equal(
      (await request(app).get(`/api/papers/${paper._id}/thumbnail`)).status,
      404,
    );
    assert.equal(
      (await request(app).get(`/api/papers/${paper._id}/preview`)).status,
      302,
    );
  } finally {
    failingStorage.mock.restore();
    if (asset) await storage.delete(asset.key);
  }
});
test("public search sees published content only and rejects query operators", async () => {
  await Paper.create([
    {
      title: "Data structure existing fixture",
      slug: "published-fixture",
      status: "published",
      year: 2023,
    },
    {
      title: "Data hidden fixture",
      slug: "pending-fixture",
      status: "pending",
      year: 2023,
    },
  ]);
  const result = await request(app).get("/api/papers?q=Data&year=2023");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 1);
  const suggestions = await request(app).get("/api/search/suggestions?q=2023");
  assert.equal(suggestions.body.data.length, 1);
  assert.equal(
    suggestions.body.data[0].name,
    "Data structure existing fixture",
  );
  assert.equal(
    (await request(app).get("/api/search/suggestions?q=structure")).body.data[0]
      .name,
    "Data structure existing fixture",
  );
  assert.equal((await request(app).get("/api/papers?year[$gt]=0")).status, 400);
  assert.equal((await request(app).get("/api/papers?limit=10000")).status, 400);
});

test("related papers include usable shared-offering metadata and exclude staff-only fields", async () => {
  const { University, Program, Branch, Semester, Subject, SubjectOffering } =
    await import("../src/modules/models.js");
  const university = await University.create({
    name: "Related fixture university",
    slug: "related-university",
  });
  const program = await Program.create({
    name: "Related fixture degree",
    slug: "related-degree",
    university: university._id,
  });
  const branch = await Branch.create({
    name: "Related fixture branch",
    slug: "related-branch",
    program: program._id,
  });
  const semester = await Semester.create({
    name: "Semester 1",
    slug: "sem-1",
    number: 1,
    program: program._id,
  });
  const subject = await Subject.create({
    name: "Related fixture subject",
    slug: "related-subject",
    code: "FIX-101",
  });
  const offering = await SubjectOffering.create({
    subject: subject._id,
    branch: branch._id,
    semester: semester._id,
    program: program._id,
  });
  const current = await Paper.create({
    title: "Related current fixture",
    slug: "related-current",
    status: "published",
    offerings: [offering._id],
  });
  await Paper.create({
    title: "Related public fixture",
    slug: "related-public",
    status: "published",
    offerings: [offering._id],
    provenance: { sources: ["private-source.pdf"] },
    rejectionReason: "staff-only",
    revisions: [{ replacedAt: new Date() }],
  });
  await Paper.create({
    title: "Related pending fixture",
    slug: "related-pending",
    status: "pending",
    offerings: [offering._id],
  });
  const response = await request(app).get(`/api/papers/${current._id}/related`);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  const item = response.body.data[0];
  assert.equal(item.offerings[0]?.subject?.name, "Related fixture subject");
  assert.equal(item.offerings[0].branch.slug, "related-branch");
  assert.equal(item.offerings[0].semester.number, 1);
  assert.equal(item.offerings[0].program.slug, "related-degree");
  for (const field of ["asset", "provenance", "revisions", "rejectionReason"])
    assert.equal(
      field in item,
      false,
      `related metadata must not include ${field}`,
    );
});
test("contributor uploads require valid PDFs and admin moderation; cannot edit other uploads", async () => {
  await account();
  await account("admin");
  const contributor = await login(),
    admin = await login("admin");
  assert.equal(
    (await contributor.agent.get("/api/admin/dashboard")).status,
    403,
  );
  const bad = await contributor.agent
    .post("/api/contributor/papers")
    .set("X-CSRF-Token", contributor.csrf)
    .field("metadata", JSON.stringify({ title: "Test only", offerings: [] }))
    .attach("file", Buffer.from("fake"), {
      filename: "fake.pdf",
      contentType: "application/pdf",
    });
  assert.equal(bad.status, 400);
  const { Subject, SubjectOffering, Branch, Semester, Program, University } =
    await import("../src/modules/models.js");
  const uni = await University.create({ name: "Fixture", slug: "fixture" }),
    program = await Program.create({
      name: "Fixture",
      slug: "fixture",
      university: uni._id,
    }),
    branch = await Branch.create({
      name: "Fixture",
      slug: "fixture",
      program: program._id,
    }),
    semester = await Semester.create({
      name: "Fixture",
      slug: "fixture",
      program: program._id,
      number: 1,
    }),
    subject = await Subject.create({
      name: "Fixture",
      code: "FIX-1",
      slug: "fixture",
    }),
    offering = await SubjectOffering.create({
      program: program._id,
      branch: branch._id,
      semester: semester._id,
      subject: subject._id,
    });
  const doc = await PDFDocument.create();
  doc.addPage();
  const upload = await contributor.agent
    .post("/api/contributor/papers")
    .set("X-CSRF-Token", contributor.csrf)
    .field(
      "metadata",
      JSON.stringify({
        title: "Moderation fixture",
        offerings: [String(offering._id)],
        year: 2023,
      }),
    )
    .attach("file", Buffer.from(await doc.save()), {
      filename: "valid.pdf",
      contentType: "application/pdf",
    });
  assert.equal(upload.status, 201);
  assert.equal(upload.body.data.status, "pending");
  const paperId = upload.body.data._id;
  assert.equal((await request(app).get(`/api/papers/${paperId}`)).status, 404);
  const other = await Paper.create({
    title: "Other fixture",
    slug: "other-fixture",
    status: "pending",
  });
  assert.equal(
    (
      await contributor.agent
        .patch(`/api/contributor/papers/${other._id}`)
        .set("X-CSRF-Token", contributor.csrf)
        .send({ title: "Stolen" })
    ).status,
    404,
  );
  assert.equal(
    (
      await admin.agent
        .post(`/api/admin/papers/${paperId}/reject`)
        .set("X-CSRF-Token", admin.csrf)
        .send({ reason: "" })
    ).status,
    400,
  );
  assert.equal(
    (
      await admin.agent
        .post(`/api/admin/papers/${paperId}/approve`)
        .set("X-CSRF-Token", admin.csrf)
        .send({})
    ).status,
    200,
  );
  assert.equal((await request(app).get(`/api/papers/${paperId}`)).status, 200);
  assert.equal(
    (
      await contributor.agent
        .patch(`/api/contributor/papers/${paperId}`)
        .set("X-CSRF-Token", contributor.csrf)
        .send({ title: "Changed published" })
    ).status,
    404,
  );
});
test("analytics deduplicates pages, respects DNT and excludes signed-in staff", async () => {
  const { DailyStats } = await import("../src/modules/models.js");
  await DailyStats.deleteMany({});
  const event = {
    eventId: "a1234567-1234-4234-8234-123456789abc",
    kind: "pageview",
    path: "/papers",
  };
  assert.equal(
    (
      await request(app)
        .post("/api/analytics/events")
        .set("User-Agent", "Mozilla/5.0 Chrome/120")
        .send({ events: [event] })
    ).status,
    202,
  );
  await request(app)
    .post("/api/analytics/events")
    .set("User-Agent", "Mozilla/5.0 Chrome/120")
    .send({ events: [event] });
  let stats = await DailyStats.findOne();
  assert.equal(stats.pageViews, 1);
  assert.equal(stats.visitors, 1);
  await request(app)
    .post("/api/analytics/events")
    .set("DNT", "1")
    .send({
      events: [{ ...event, eventId: "b1234567-1234-4234-8234-123456789abc" }],
    });
  await account("admin");
  const { agent } = await login("admin");
  await agent.post("/api/analytics/events").send({
    events: [{ ...event, eventId: "c1234567-1234-4234-8234-123456789abc" }],
  });
  stats = await DailyStats.findOne();
  assert.equal(stats.pageViews, 1);
  assert.equal((await agent.get("/api/admin/analytics?days=7")).status, 200);
});

async function offeringFixture() {
  const { University, Program, Branch, Semester, Subject, SubjectOffering } =
    await import("../src/modules/models.js");
  const suffix = new mongoose.Types.ObjectId().toString();
  const university = await University.create({
    name: "Test university",
    slug: `test-${suffix}`,
  });
  const program = await Program.create({
    name: "Test program",
    slug: `test-${suffix}`,
    university: university._id,
  });
  const branch = await Branch.create({
    name: "Test branch",
    slug: `test-${suffix}`,
    program: program._id,
  });
  const semester = await Semester.create({
    name: "Test semester",
    slug: `test-${suffix}`,
    number: 1,
    program: program._id,
  });
  const subject = await Subject.create({
    name: "Test subject",
    slug: `test-${suffix}`,
    code: `FIX-${suffix}`,
  });
  const offering = await SubjectOffering.create({
    subject: subject._id,
    program: program._id,
    branch: branch._id,
    semester: semester._id,
  });
  return { subject, offering, branch, semester, program };
}

test("Markdown notes require moderation; title-only edits preserve metadata and associations", async () => {
  await account();
  await account("admin");
  const contributor = await login(),
    admin = await login("admin");
  const { offering } = await offeringFixture();
  const created = await contributor.agent
    .post("/api/contributor/notes")
    .set("X-CSRF-Token", contributor.csrf)
    .send({
      title: "Markdown fixture",
      offerings: [String(offering._id)],
      format: "markdown",
      markdown: "# Test note\n<script>alert(1)</script>",
      tags: ["test"],
      unit: "Unit 1",
      credit: "Test author",
    });
  assert.equal(created.status, 201);
  const id = created.body.data._id;
  assert.equal((await request(app).get(`/api/notes/${id}`)).status, 404);
  const edited = await contributor.agent
    .patch(`/api/contributor/notes/${id}`)
    .set("X-CSRF-Token", contributor.csrf)
    .send({ title: "Edited Markdown fixture" });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.data.offerings, [String(offering._id)]);
  assert.deepEqual(edited.body.data.tags, ["test"]);
  assert.equal(edited.body.data.format, "markdown");
  assert.equal(
    (
      await admin.agent
        .post(`/api/admin/notes/${id}/approve`)
        .set("X-CSRF-Token", admin.csrf)
        .send({})
    ).status,
    200,
  );
  assert.equal(
    (await request(app).get(`/api/notes/${id}`)).body.data.credit,
    "Test author",
  );
  assert.equal(
    (
      await contributor.agent
        .patch(`/api/contributor/notes/${id}`)
        .set("X-CSRF-Token", contributor.csrf)
        .send({ status: "published" })
    ).status,
    404,
  );
  assert.equal(
    (
      await admin.agent
        .post(`/api/admin/notes/${id}/delete`)
        .set("X-CSRF-Token", admin.csrf)
        .send({})
    ).status,
    200,
  );
  assert.equal((await request(app).get(`/api/notes/${id}`)).status, 404);
  assert.equal(
    (
      await admin.agent
        .post(`/api/admin/notes/${id}/restore`)
        .set("X-CSRF-Token", admin.csrf)
        .send({})
    ).status,
    200,
  );
  assert.equal((await request(app).get(`/api/notes/${id}`)).status, 200);
});

test("taxonomy rename preserves inactive state and order; offering patches validate ObjectId parents", async () => {
  await account("admin");
  const { agent, csrf } = await login("admin");
  const { branch, offering } = await offeringFixture();
  await branch.updateOne({ active: false, order: 7 });
  const renamed = await agent
    .patch(`/api/admin/taxonomy/branches/${branch._id}`)
    .set("X-CSRF-Token", csrf)
    .send({ name: "Renamed fixture" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.active, false);
  assert.equal(renamed.body.data.order, 7);
  assert.equal(
    (
      await agent
        .patch(`/api/admin/taxonomy/offerings/${offering._id}`)
        .set("X-CSRF-Token", csrf)
        .send({ scheme: "verified-test" })
    ).status,
    200,
  );
});

test("taxonomy merge reconciles duplicate offerings without losing paper/note references", async () => {
  await account("admin");
  const { agent, csrf } = await login("admin");
  const { subject, offering, branch, semester, program } =
    await offeringFixture();
  const { Subject, SubjectOffering } = await import("../src/modules/models.js");
  const second = await Subject.create({
    name: "Duplicate test subject",
    code: "DUP-TEST",
    slug: "duplicate-test",
  });
  const duplicate = await SubjectOffering.create({
    subject: second._id,
    branch: branch._id,
    semester: semester._id,
    program: program._id,
  });
  const paper = await Paper.create({
    title: "Merge fixture",
    slug: "merge-fixture",
    offerings: [offering._id, duplicate._id],
    status: "pending",
  });
  const note = await Note.create({
    title: "Merge note",
    slug: "merge-note",
    offerings: [duplicate._id],
    format: "markdown",
    markdown: "Fixture",
    status: "pending",
  });
  assert.equal(
    (
      await agent
        .post("/api/admin/taxonomy/subjects/merge")
        .set("X-CSRF-Token", csrf)
        .send({ from: String(second._id), to: String(subject._id) })
    ).status,
    200,
  );
  assert.equal(
    await SubjectOffering.countDocuments({ subject: second._id }),
    0,
  );
  assert.deepEqual((await Paper.findById(paper._id)).offerings.map(String), [
    String(offering._id),
  ]);
  assert.deepEqual((await Note.findById(note._id)).offerings.map(String), [
    String(offering._id),
  ]);
});

test("admin password reset revokes contributor sessions; bcrypt truncation is rejected", async () => {
  const user = await account();
  await account("admin");
  const contributor = await login(),
    admin = await login("admin");
  const reset = (password: string) =>
    admin.agent
      .post(`/api/admin/contributors/${user._id}/reset-password`)
      .set("X-CSRF-Token", admin.csrf)
      .send({ temporaryPassword: password });
  assert.equal((await reset("é".repeat(40))).status, 400);
  assert.equal((await reset("ReplacementPassword!123")).status, 200);
  assert.equal((await contributor.agent.get("/api/auth/me")).status, 401);
  assert.equal((await User.findById(user._id)).mustChangePassword, true);
});

test("PDF note downloads respect visitor exclusions, deduplicate, and appear by title in aggregate reports", async () => {
  const { DailyStats, DailyMetric, AnalyticsEvent } =
    await import("../src/modules/models.js");
  await DailyStats.deleteMany({});
  await DailyMetric.deleteMany({});
  await AnalyticsEvent.deleteMany({});
  await account("admin");
  const { agent } = await login("admin");
  const { offering } = await offeringFixture();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Note analytics fixture");
  const { savePdf } = await import("../src/storage/index.js");
  const asset = await savePdf({
    buffer: Buffer.from(await pdf.save()),
    mimetype: "application/pdf",
    originalname: "fixture.pdf",
  });
  const note = await Note.create({
    title: "Note analytics fixture",
    slug: "note-analytics",
    format: "pdf",
    asset: asset._id,
    offerings: [offering._id],
    status: "published",
  });
  const url = `/api/notes/${note._id}/download`;
  await request(app)
    .post(url)
    .set("DNT", "1")
    .set("Idempotency-Key", "d1234567-1234-4234-8234-123456789abc");
  await request(app)
    .post(url)
    .set("User-Agent", "Googlebot")
    .set("Idempotency-Key", "e1234567-1234-4234-8234-123456789abc");
  await agent
    .post(url)
    .set("Idempotency-Key", "f1234567-1234-4234-8234-123456789abc");
  assert.equal((await Note.findById(note._id)).downloads, 0);
  assert.equal(await AnalyticsEvent.countDocuments(), 0);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(app)
          .post(url)
          .set("User-Agent", "Mozilla/5.0 Chrome/120")
          .set("Idempotency-Key", "11234567-1234-4234-8234-123456789abc")
      ).status,
      200,
    );
  assert.equal((await Note.findById(note._id)).downloads, 1);
  const report = await agent.get("/api/admin/analytics?days=7");
  assert.equal(
    report.body.data.top.find((row: any) => row.kind === "download").title,
    note.title,
  );
  assert.equal((await request(app).get("/api/stats")).body.data.downloads, 1);
  assert.equal(
    (await agent.get("/api/admin/dashboard")).body.data.downloads,
    1,
  );
});
