import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { resolve } from "node:path";
import { User, JobPost, JobApplication } from "../src/modules/models.js";
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
    email: `${role}@careers.test`,
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
    .send({ email: `${role}@careers.test`, password: "TestPassword!12345" });
  return { agent, csrf };
}
const application = {
  name: "Asha Verma",
  email: "asha@example.test",
  phone: "+91 98765 43210",
  branch: "CSE",
  semester: 7,
  resumeUrl: "https://drive.google.com/file/d/abc/view",
  note: "I built two React projects.",
};
test("admins post openings, students apply once, closed posts reject", async () => {
  const { agent, csrf } = await signIn("admin");
  const contributor = await signIn("contributor");
  const draft = {
    title: "Frontend Intern",
    kind: "internship",
    company: "Acme Labs",
    location: "Bhopal",
    mode: "hybrid",
    pay: "₹10,000 / month",
    description: "Build and test React screens with the product team.",
  };
  assert.equal(
    (
      await contributor.agent
        .post("/api/admin/careers")
        .set("X-CSRF-Token", contributor.csrf)
        .send(draft)
    ).status,
    403,
  );
  const created = await agent
    .post("/api/admin/careers")
    .set("X-CSRF-Token", csrf)
    .send(draft);
  assert.equal(created.status, 201);
  const slug = created.body.data.slug;

  const list = await request(app).get("/api/jobs?kind=internship");
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].description, undefined);
  const detail = await request(app).get(`/api/jobs/${slug}`);
  assert.equal(detail.body.data.open, true);
  assert.equal(detail.body.data.author, undefined);

  assert.equal(
    (
      await request(app)
        .post(`/api/jobs/${slug}/apply`)
        .send({ ...application, resumeUrl: "javascript:alert(1)" })
    ).status,
    400,
  );
  assert.equal(
    (await request(app).post(`/api/jobs/${slug}/apply`).send(application))
      .status,
    201,
  );
  assert.equal(
    (
      await request(app)
        .post(`/api/jobs/${slug}/apply`)
        .send({ ...application, email: "ASHA@example.test" })
    ).status,
    409,
  );
  const applications = await agent.get(
    `/api/admin/careers/${created.body.data._id}/applications`,
  );
  assert.equal(applications.body.data.length, 1);
  assert.equal((await JobPost.findOne({ slug })).applications, 1);
  const shortlisted = await agent
    .patch(`/api/admin/careers/applications/${applications.body.data[0]._id}`)
    .set("X-CSRF-Token", csrf)
    .send({ status: "shortlisted" });
  assert.equal(shortlisted.body.data.status, "shortlisted");

  await agent
    .patch(`/api/admin/careers/${created.body.data._id}`)
    .set("X-CSRF-Token", csrf)
    .send({ deadline: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  assert.equal((await request(app).get("/api/jobs")).body.data.length, 0);
  assert.equal(
    (
      await request(app)
        .post(`/api/jobs/${slug}/apply`)
        .send({ ...application, email: "late@example.test" })
    ).status,
    404,
  );

  await agent
    .delete(`/api/admin/careers/${created.body.data._id}`)
    .set("X-CSRF-Token", csrf);
  assert.equal(await JobApplication.countDocuments(), 0);
});
