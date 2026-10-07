import mongoose, { Schema } from "mongoose";
const ref = (model: string, required = false) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required,
});
const model = (name: string, schema: Schema): mongoose.Model<any> =>
  mongoose.models[name] || mongoose.model(name, schema);
const options = { timestamps: true, strict: true };
const taxonomy = {
  name: { type: String, required: true, maxlength: 160 },
  slug: { type: String, required: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  aliases: [String],
};
export const University = model(
  "University",
  new Schema({ ...taxonomy, notice: String }, options),
);
export const Program = model(
  "Program",
  new Schema({ ...taxonomy, university: ref("University", true) }, options),
);
export const Branch = model(
  "Branch",
  new Schema(
    { ...taxonomy, program: ref("Program", true), code: String },
    options,
  ),
);
export const Semester = model(
  "Semester",
  new Schema(
    {
      ...taxonomy,
      program: ref("Program", true),
      number: { type: Number, required: true, min: 1, max: 20 },
    },
    options,
  ),
);
export const Subject = model(
  "Subject",
  new Schema(
    {
      ...taxonomy,
      code: { type: String, required: true },
      scheme: String,
      verified: { type: Boolean, default: false },
      originalLabel: String,
    },
    options,
  ),
);
const offeringSchema = new Schema(
  {
    subject: ref("Subject", true),
    branch: ref("Branch", true),
    semester: ref("Semester", true),
    program: ref("Program", true),
    scheme: { type: String, default: "" },
  },
  options,
);
offeringSchema.index(
  { subject: 1, branch: 1, semester: 1, scheme: 1 },
  { unique: true },
);
export const SubjectOffering = model("SubjectOffering", offeringSchema);
const assetSchema = new Schema(
  {
    key: { type: String, required: true },
    hash: { type: String, required: true },
    size: Number,
    mime: String,
    originalName: String,
    sources: [String],
    thumbnailKey: String,
    deletedAt: Date,
  },
  options,
);
assetSchema.index({ hash: 1 }, { unique: true });
export const FileAsset = model("FileAsset", assetSchema);
// Versioned files: the original upload is never overwritten. `asset` is always the
// file the public receives (the watermarked active version once processing is done).
const fileVersions = new Schema(
  {
    original: ref("FileAsset"),
    processed: ref("FileAsset"),
    processedMeta: Schema.Types.Mixed,
    watermarked: {
      original: ref("FileAsset"),
      processed: ref("FileAsset"),
      originalSignature: String,
      processedSignature: String,
    },
  },
  { _id: false },
);
const watermarkState = new Schema(
  {
    status: {
      type: String,
      enum: ["none", "queued", "running", "done", "skipped", "failed"],
      default: "none",
    },
    // New uploads stay off public routes until their first watermark is ready.
    hold: { type: Boolean, default: false },
    text: String,
    revision: Number,
    reason: String,
    error: String,
    appliedAt: Date,
  },
  { _id: false },
);
const contentFields = {
  title: { type: String, required: true, maxlength: 240 },
  slug: { type: String, required: true },
  offerings: [ref("SubjectOffering")],
  asset: ref("FileAsset"),
  author: ref("User"),
  credit: String,
  tags: [String],
  status: {
    type: String,
    enum: ["draft", "pending", "published", "rejected"],
    default: "draft",
  },
  rejectionReason: String,
  featured: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  publishedAt: Date,
  downloads: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  revisions: [
    { asset: ref("FileAsset"), replacedAt: Date, actor: ref("User") },
  ],
  provenance: Schema.Types.Mixed,
  metadataNeedsReview: { type: Boolean, default: false },
  files: { type: fileVersions, default: undefined },
  activeVersion: {
    type: String,
    enum: ["original", "processed"],
    default: "original",
  },
  watermark: { type: watermarkState, default: undefined },
};
const paperSchema = new Schema(
  {
    ...contentFields,
    year: { type: Number, min: 1900, max: 2200 },
    session: String,
    examType: {
      type: String,
      enum: ["Mid-Sem", "End-Sem", "Supplementary", "Other", "Unknown"],
      default: "Unknown",
    },
    scheme: String,
  },
  options,
);
const noteSchema = new Schema(
  {
    ...contentFields,
    format: { type: String, enum: ["pdf", "markdown"], default: "pdf" },
    markdown: { type: String, maxlength: 100_000 },
    unit: String,
    topic: String,
  },
  options,
);
for (const schema of [paperSchema, noteSchema]) {
  schema.index({ slug: 1 }, { unique: true });
  schema.index({ status: 1, deletedAt: 1, offerings: 1, createdAt: -1 });
  schema.index({ status: 1, deletedAt: 1, downloads: -1 });
  schema.index({ title: "text", tags: "text", credit: "text" });
}
export const Paper = model("Paper", paperSchema);
export const Note = model("Note", noteSchema);
const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["admin", "contributor"], required: true },
    active: { type: Boolean, default: true },
    trusted: { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: true },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
  },
  options,
);
export const User = model("User", userSchema);
const sessionSchema = new Schema(
  {
    user: ref("User", true),
    refreshHash: { type: String, required: true },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  options,
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = model("Session", sessionSchema);
export const AuditLog = model(
  "AuditLog",
  new Schema(
    {
      actor: ref("User"),
      action: { type: String, required: true },
      target: String,
      ipHash: String,
      details: Schema.Types.Mixed,
    },
    options,
  ),
);
const inboxFields = {
  message: { type: String, required: true, maxlength: 2000 },
  email: String,
  status: {
    type: String,
    enum: ["open", "in-progress", "resolved"],
    default: "open",
  },
  response: String,
  contentType: String,
  content: Schema.Types.ObjectId,
  offering: ref("SubjectOffering"),
  year: Number,
};
export const Report = model("Report", new Schema(inboxFields, options));
export const PaperRequest = model(
  "PaperRequest",
  new Schema(inboxFields, options),
);
const visitorSchema = new Schema({
  day: String,
  visitor: String,
  expiresAt: Date,
});
visitorSchema.index({ day: 1, visitor: 1 }, { unique: true });
visitorSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const DailyVisitor = model("DailyVisitor", visitorSchema);
const eventSchema = new Schema({
  eventId: { type: String, unique: true },
  day: String,
  visitor: String,
  kind: String,
  content: String,
  query: String,
  expiresAt: Date,
});
eventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AnalyticsEvent = model("AnalyticsEvent", eventSchema);
export const DailyStats = model(
  "DailyStats",
  new Schema({
    day: { type: String, unique: true },
    visitors: { type: Number, default: 0 },
    pageViews: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
    devices: { type: Map, of: Number },
    browsers: { type: Map, of: Number },
    referrers: { type: Map, of: Number },
    countries: { type: Map, of: Number },
  }),
);
const metricSchema = new Schema({
  day: String,
  kind: String,
  key: String,
  count: { type: Number, default: 0 },
  zeroResults: { type: Number, default: 0 },
});
metricSchema.index({ day: 1, kind: 1, key: 1 }, { unique: true });
export const DailyMetric = model("DailyMetric", metricSchema);
export const publicationFilter = { status: "published", deletedAt: null };
export const taxonomyModels = {
  universities: University,
  programs: Program,
  branches: Branch,
  semesters: Semester,
  subjects: Subject,
  offerings: SubjectOffering,
};
export const contentModels = { papers: Paper, notes: Note };

export const Setting = model(
  "Setting",
  new Schema(
    {
      key: { type: String, required: true, unique: true },
      value: Schema.Types.Mixed,
      revision: { type: Number, default: 1 },
      updatedBy: ref("User"),
    },
    options,
  ),
);
const jobSchema = new Schema(
  {
    type: { type: String, enum: ["watermark", "thumbnail"], required: true },
    contentType: { type: String, enum: ["papers", "notes"], required: true },
    content: { type: Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      enum: ["queued", "running", "done", "failed"],
      default: "queued",
    },
    attempts: { type: Number, default: 0 },
    runAfter: { type: Date, default: () => new Date() },
    leaseUntil: Date,
    error: String,
    batch: String,
    requestedBy: ref("User"),
    startedAt: Date,
    finishedAt: Date,
    durationMs: Number,
  },
  options,
);
jobSchema.index({ status: 1, runAfter: 1, createdAt: 1 });
jobSchema.index({ content: 1, type: 1, status: 1 });
jobSchema.index(
  { finishedAt: 1 },
  {
    expireAfterSeconds: 30 * 86_400,
    partialFilterExpression: { status: "done" },
  },
);
export const ProcessingJob = model("ProcessingJob", jobSchema);
