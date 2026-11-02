import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { HttpError, identifier, ok } from "../lib/http.js";
import { slugify } from "../import/inventory.js";
import { audit, type AuthRequest } from "./auth.js";
import { JobApplication, JobPost } from "./models.js";

/*
 * Jobs and internships. Admins post openings; students apply with a short form
 * (résumé as a link, so no personal files are stored here).
 */
const publicFields = "-author -applications";
// A post is open while it is active and its deadline (end of that day) has not passed.
const openFilter = () => ({
  active: true,
  $or: [
    { deadline: null },
    { deadline: { $gte: new Date(Date.now() - 86_400_000) } },
  ],
});
const httpUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), "Use an http(s) link.");

export const careersRouter = Router();
careersRouter.get("/jobs", async (req, res) => {
  const kind = z.enum(["job", "internship"]).optional().parse(req.query.kind);
  ok(
    res,
    await JobPost.find({ ...openFilter(), ...(kind ? { kind } : {}) })
      .select(`${publicFields} -description`)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  );
});
careersRouter.get("/jobs/:slug", async (req, res) => {
  const slug = z.string().max(200).parse(req.params.slug);
  const post = await JobPost.findOne({ slug, active: true })
    .select(publicFields)
    .lean<any>();
  if (!post) throw new HttpError(404, "This opening is no longer listed.");
  ok(res, {
    ...post,
    open: !post.deadline || post.deadline >= new Date(Date.now() - 86_400_000),
  });
});
const applyLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({
      error: {
        code: "RATE_LIMIT",
        message: "Too many applications from here. Try again later.",
        requestId: res.locals.requestId,
      },
    }),
});
const applicationInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().max(254),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 -]{7,18}$/, "Enter a valid phone number."),
    branch: z.string().trim().max(80).optional(),
    semester: z.coerce.number().int().min(1).max(12).optional(),
    graduationYear: z.coerce.number().int().min(2000).max(2100).optional(),
    college: z.string().trim().max(160).optional(),
    resumeUrl: httpUrl,
    note: z.string().trim().max(1500).optional(),
    // Bot trap: humans never see or fill this field.
    website: z.string().max(200).optional(),
  })
  .strict();
careersRouter.post("/jobs/:slug/apply", applyLimit, async (req, res) => {
  const { website, ...data } = applicationInput.parse(req.body);
  const slug = z.string().max(200).parse(req.params.slug);
  const post = await JobPost.findOne({ slug, ...openFilter() });
  if (!post)
    throw new HttpError(404, "Applications for this opening are closed.");
  if (post.externalUrl)
    throw new HttpError(400, "Apply for this opening on the company's site.");
  res.status(201);
  if (website) return ok(res, { applied: true });
  try {
    await JobApplication.create({
      ...data,
      email: data.email.toLowerCase(),
      post: post._id,
    });
  } catch (error: any) {
    if (error.code === 11000)
      throw new HttpError(
        409,
        "You have already applied for this opening with this email.",
        "ALREADY_APPLIED",
      );
    throw error;
  }
  await JobPost.updateOne({ _id: post._id }, { $inc: { applications: 1 } });
  ok(res, { applied: true });
});

const postInput = z
  .object({
    title: z.string().trim().min(3).max(160),
    kind: z.enum(["job", "internship"]),
    company: z.string().trim().min(2).max(120),
    location: z.string().trim().max(120).optional(),
    mode: z.enum(["onsite", "remote", "hybrid"]).default("onsite"),
    pay: z.string().trim().max(80).optional(),
    duration: z.string().trim().max(80).optional(),
    eligibility: z.string().trim().max(400).optional(),
    description: z.string().trim().min(20).max(8000),
    deadline: z.coerce.date().nullable().optional(),
    externalUrl: httpUrl.optional().or(z.literal("")),
    active: z.boolean().default(true),
  })
  .strict();

export const careersAdminRouter = Router();
careersAdminRouter.get("/careers", async (_req, res) => {
  ok(res, await JobPost.find().sort({ createdAt: -1 }).limit(300).lean());
});
careersAdminRouter.post("/careers", async (req: AuthRequest, res) => {
  const data = postInput.parse(req.body);
  const post = await JobPost.create({
    ...data,
    externalUrl: data.externalUrl || undefined,
    slug: `${slugify(`${data.title} ${data.company}`).slice(0, 80)}-${randomUUID().slice(0, 6)}`,
    author: req.user._id,
  });
  await audit(req, "job-posted", String(post._id));
  res.status(201);
  ok(res, post);
});
careersAdminRouter.patch("/careers/:id", async (req: AuthRequest, res) => {
  const data = postInput.partial().parse(req.body);
  const unset: Record<string, ""> = {};
  if (data.externalUrl === "") {
    delete data.externalUrl;
    unset.externalUrl = "";
  }
  if (data.deadline === null) {
    delete data.deadline;
    unset.deadline = "";
  }
  const post = await JobPost.findByIdAndUpdate(
    identifier(req.params.id),
    { $set: data, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: "after", runValidators: true },
  );
  if (!post) throw new HttpError(404, "Opening not found");
  await audit(req, "job-updated", String(post._id));
  ok(res, post);
});
careersAdminRouter.delete("/careers/:id", async (req: AuthRequest, res) => {
  const id = identifier(req.params.id);
  const post = await JobPost.findByIdAndDelete(id);
  if (!post) throw new HttpError(404, "Opening not found");
  await JobApplication.deleteMany({ post: id });
  await audit(req, "job-deleted", id);
  ok(res, { deleted: true });
});
careersAdminRouter.get("/careers/:id/applications", async (req, res) => {
  ok(
    res,
    await JobApplication.find({ post: identifier(req.params.id) })
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean(),
  );
});
careersAdminRouter.patch(
  "/careers/applications/:id",
  async (req: AuthRequest, res) => {
    const { status } = z
      .object({ status: z.enum(["new", "shortlisted", "rejected", "hired"]) })
      .strict()
      .parse(req.body);
    const application = await JobApplication.findByIdAndUpdate(
      identifier(req.params.id),
      { $set: { status } },
      { returnDocument: "after" },
    );
    if (!application) throw new HttpError(404, "Application not found");
    ok(res, application);
  },
);
