import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { resolve } from "node:path";
import {
  User,
  University,
  Program,
  Branch,
  Semester,
  Subject,
  SubjectOffering,
  Syllabus,
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
async function signIn(role: "admin" | "contributor") {
  await User.create({
    email: `${role}@syllabus.test`,
    name: role,
    role,
    passwordHash: await bcrypt.hash("TestPassword!12345", 12),
    mustChangePassword: false,
  });
  const agent = request.agent(app);
  const csrf = (await agent.get("/api/auth/csrf")).body.data.token;
  await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ email: `${role}@syllabus.test`, password: "TestPassword!12345" });
  return { agent, csrf };
}
const md = (topic: string) =>
  `## Unit I – Basics

${topic}, definitions and examples.

## Reference books

1. A Book`;
test("admins import and edit syllabi; the public sees published ones with their offerings", async () => {
  const university = await University.create({ name: "BU", slug: "bu" });
  const program = await Program.create({
    name: "B.Tech",
    slug: "btech",
    university: university._id,
  });
  const branch = await Branch.create({
    name: "Computer Science",
    slug: "cse",
    code: "CSE",
    program: program._id,
  });
  const semester = await Semester.create({
    name: "Semester 3",
    slug: "sem-3",
    number: 3,
    program: program._id,
  });
  const dsa = await Subject.create({
    name: "DATA STRUCTURE",
    slug: "cse-303",
    code: "CSE-303",
  });
  const placeholder = await Subject.create({
    name: "CSE-304",
    slug: "cse-304",
    code: "CSE-304",
  });
  await SubjectOffering.create({
    subject: dsa._id,
    branch: branch._id,
    semester: semester._id,
    program: program._id,
  });
  const { agent, csrf } = await signIn("admin");
  const contributor = await signIn("contributor");
  const items = [
    {
      code: "CS-303",
      name: "Data Structure & Algorithm",
      markdown: md("Arrays"),
      credits: { L: 3, T: 1, P: 0, total: 4 },
    },
    {
      code: "CS-304",
      name: "Database Management System",
      markdown: md("ER model"),
    },
    { code: "CS-399", name: "Not In The Catalogue", markdown: md("Nothing") },
  ];
  assert.equal(
    (
      await contributor.agent
        .post("/api/admin/syllabus/import")
        .set("X-CSRF-Token", contributor.csrf)
        .send({ items })
    ).status,
    403,
  );
  const dry = await agent
    .post("/api/admin/syllabus/import")
    .set("X-CSRF-Token", csrf)
    .send({ items, dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.deepEqual(dry.body.data.created, ["CSE-303", "CSE-304"]);
  assert.equal(await Syllabus.countDocuments(), 0);
  const run = await agent
    .post("/api/admin/syllabus/import")
    .set("X-CSRF-Token", csrf)
    .send({ items });
  assert.deepEqual(run.body.data.unmatched, ["CS-399 Not In The Catalogue"]);
  // Only the placeholder name is replaced by default.
  assert.deepEqual(run.body.data.renamed, [
    "CSE-304: CSE-304 → Database Management System",
  ]);
  assert.equal((await Subject.findById(dsa._id))!.name, "DATA STRUCTURE");
  assert.equal(
    (await Subject.findById(placeholder._id))!.name,
    "Database Management System",
  );

  const list = await request(app).get("/api/syllabus");
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 2);
  const first = list.body.data.find((s: any) => s.subject.code === "CSE-303");
  assert.equal(first.slug, "cse-303-data-structure");
  assert.equal(first.markdown, undefined);
  assert.equal(first.offerings[0].branch.code, "CSE");
  assert.equal(first.offerings[0].semester.number, 3);
  const full = await request(app).get("/api/syllabus?full=1");
  assert.match(full.body.data[0].markdown, /Unit I/);
  const page = await request(app).get(`/api/syllabus/${first.slug}`);
  assert.equal(page.body.data.credits.total, 4);

  // A re-import updates in place and keeps the address.
  const again = await agent
    .post("/api/admin/syllabus/import")
    .set("X-CSRF-Token", csrf)
    .send({ items: [items[0]] });
  assert.deepEqual(again.body.data.updated, ["CSE-303"]);
  assert.equal(await Syllabus.countDocuments(), 2);

  // Unpublishing hides the page; deleting removes it.
  const edit = await agent
    .put(`/api/admin/syllabus/${dsa._id}`)
    .set("X-CSRF-Token", csrf)
    .send({ markdown: md("Stacks"), published: false });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(
    (await request(app).get(`/api/syllabus/${first.slug}`)).status,
    404,
  );
  assert.equal(
    (
      await agent
        .delete(`/api/admin/syllabus/${placeholder._id}`)
        .set("X-CSRF-Token", csrf)
    ).status,
    200,
  );
  assert.equal((await request(app).get("/api/syllabus")).body.data.length, 0);
  assert.equal(
    (
      await agent
        .put(`/api/admin/syllabus/${dsa._id}`)
        .set("X-CSRF-Token", csrf)
        .send({ markdown: "short" })
    ).status,
    400,
  );
});
