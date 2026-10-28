import { catalogFilter } from "./catalog.js";
import mongoose from "mongoose";
import { createHmac } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { ok } from "../lib/http.js";
import { config } from "../config.js";
import { AuthRequest, optionalUser } from "./auth.js";
import {
  AnalyticsEvent,
  DailyStats,
  DailyVisitor,
  DailyMetric,
  DownloadLog,
  Subject,
  SubjectOffering,
  contentModels,
  publicationFilter,
} from "./models.js";
export const dayKey = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const hourKey = (date = new Date()) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
export function visitorKey(req: AuthRequest, day = dayKey()) {
  return createHmac("sha256", config.analyticsSecret)
    .update(`${day}|${req.ip || ""}|${req.get("User-Agent") || ""}`)
    .digest("hex");
}
const untracked = (req: AuthRequest) =>
  req.get("DNT") === "1" ||
  /bot|crawler|spider|headless|preview|slurp|curl|wget|python-requests/i.test(
    req.get("User-Agent") || "",
  );
const staffRequest = (req: AuthRequest) => !!req.user || !!req.cookies?.refresh;
export function excluded(req: AuthRequest) {
  return staffRequest(req) || untracked(req);
}
export function clientInfo(req: AuthRequest) {
  const ua = req.get("User-Agent") || "";
  const device = /mobile|android|iphone/i.test(ua)
    ? "mobile"
    : /ipad|tablet/i.test(ua)
      ? "tablet"
      : "desktop";
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /opr\/|opera/i.test(ua)
      ? "Opera"
      : /samsungbrowser/i.test(ua)
        ? "Samsung Internet"
        : /firefox|fxios/i.test(ua)
          ? "Firefox"
          : /chrome|crios/i.test(ua)
            ? "Chrome"
            : /safari/i.test(ua)
              ? "Safari"
              : "Other";
  const os = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad|ipod/i.test(ua)
      ? "iOS"
      : /windows/i.test(ua)
        ? "Windows"
        : /cros/i.test(ua)
          ? "ChromeOS"
          : /mac os x|macintosh/i.test(ua)
            ? "macOS"
            : /linux/i.test(ua)
              ? "Linux"
              : "Other";
  const country =
    config.cfOriginSecret &&
    req.get("X-Origin-Verify") === config.cfOriginSecret &&
    /^[A-Z]{2}$/.test(req.get("CF-IPCountry") || "")
      ? (req.get("CF-IPCountry") as string)
      : "Unknown";
  return { device, browser, os, country };
}
export function normalizeQuery(query: string) {
  return query
    .trim()
    .toLowerCase()
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\b\+?\d[\d\s-]{8,}\d\b/g, "[number]")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}
const eventInput = z
  .object({
    eventId: z.uuid(),
    kind: z.enum(["pageview", "contentview", "search"]),
    path: z.string().max(240).optional(),
    contentId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .optional(),
    contentType: z.enum(["papers", "notes"]).optional(),
    query: z.string().max(120).optional(),
    referrer: z.string().max(500).optional(),
  })
  .strict();
async function metric(
  day: string,
  kind: string,
  key: string,
  session: any,
  zero = false,
) {
  await DailyMetric.updateOne(
    { day, kind, key },
    { $inc: { count: 1, ...(zero ? { zeroResults: 1 } : {}) } },
    { upsert: true, session },
  );
}
export async function recordBatch(
  req: AuthRequest,
  events: z.infer<typeof eventInput>[],
) {
  if (excluded(req)) return;
  const day = dayKey(),
    visitor = visitorKey(req, day),
    { device, browser, os, country } = clientInfo(req);
  for (const event of events) {
    if (event.path && /^\/(?:admin|contributor|auth)(?:\/|$)/.test(event.path))
      continue;
    const query =
      event.kind === "search" ? normalizeQuery(event.query || "") : undefined;
    let content: any;
    if (event.kind === "contentview") {
      if (!event.contentId || !event.contentType) continue;
      content = await contentModels[event.contentType].findOne({
        _id: event.contentId,
        ...publicationFilter,
      });
      if (!content) continue;
    }
    let referrer = "direct";
    try {
      if (event.referrer)
        referrer = new URL(event.referrer).hostname
          .replace(/[.$]/g, "_")
          .slice(0, 120);
    } catch {}
    // Search counts are server-derived; clients cannot invent a zero-result gap.
    let zero = false;
    if (query) {
      const { filter } = await catalogFilter({ q: query });
      const matches = await Promise.all(
        Object.values(contentModels).map((m) => m.exists(filter)),
      );
      zero = !matches.some(Boolean);
    }
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await AnalyticsEvent.create(
          [
            {
              eventId: event.eventId,
              day,
              visitor,
              kind: event.kind,
              content: event.contentId,
              query,
              expiresAt: new Date(Date.now() + 7 * 86400_000),
            },
          ],
          { session },
        );
        const unique = await DailyVisitor.updateOne(
          { day, visitor },
          { $setOnInsert: { expiresAt: new Date(Date.now() + 2 * 86400_000) } },
          { upsert: true, session },
        );
        const increment: any = { visitors: unique.upsertedCount ? 1 : 0 };
        if (event.kind === "pageview") {
          increment.pageViews = 1;
          increment[`devices.${device}`] = 1;
          increment[`browsers.${browser}`] = 1;
          increment[`os.${os}`] = 1;
          increment[`countries.${country}`] = 1;
          increment[`referrers.${referrer}`] = 1;
        }
        if (event.kind === "contentview") increment.contentViews = 1;
        if (query) increment.searches = 1;
        await DailyStats.updateOne(
          { day },
          { $inc: increment },
          { upsert: true, session },
        );
        if (query) await metric(day, "search", query, session, zero);
        if (content) {
          await contentModels[event.contentType].updateOne(
            { _id: content._id },
            { $inc: { views: 1 } },
            { session },
          );
          await metric(day, event.contentType, String(content._id), session);
          const offerings = await SubjectOffering.find({
            _id: { $in: content.offerings },
          }).session(session);
          for (const subject of new Set(
            offerings.map((o) => String(o.subject)),
          ))
            await metric(day, "subject", subject, session);
        }
      });
    } catch (e: any) {
      if (e.code !== 11000) throw e;
    } finally {
      await session.endSession();
    }
  }
}
/** Subject, branch and semester names for a resource, for the download log. */
async function placement(item: any) {
  const offerings: any[] = await SubjectOffering.find({
    _id: { $in: item.offerings || [] },
  })
    .populate("subject", "name")
    .populate("branch", "name code")
    .populate("semester", "name number")
    .lean();
  const names = (values: (string | undefined)[]) => [
    ...new Set(values.filter(Boolean) as string[]),
  ];
  return {
    subjects: names(offerings.map((o) => o.subject?.name)),
    branches: names(offerings.map((o) => o.branch?.code || o.branch?.name)),
    semesters: names(
      offerings.map((o) =>
        o.semester?.number ? `Sem ${o.semester.number}` : o.semester?.name,
      ),
    ),
  };
}
const pagePath = z
  .string()
  .max(240)
  .regex(/^\/[^\s]*$/);
export async function recordDownload(
  req: AuthRequest,
  item: any,
  kind: string,
  eventId: string,
) {
  if (untracked(req)) return;
  // Staff downloads are logged by name for the audit trail but never counted.
  const staff = staffRequest(req);
  const now = new Date(),
    day = dayKey(now),
    page = pagePath.safeParse(req.body?.page);
  const entry = {
    eventId,
    at: now,
    day,
    hour: hourKey(now),
    kind,
    content: item._id,
    title: item.title,
    slug: item.slug,
    ...(await placement(item)),
    year: item.year,
    examType: item.examType,
    visitor: visitorKey(req, day).slice(0, 10),
    staff,
    userName: req.user?.name,
    userRole: req.user?.role,
    ...clientInfo(req),
    page: page.success ? page.data : undefined,
    expiresAt: new Date(now.getTime() + 180 * 86400_000),
  };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await DownloadLog.create([entry], { session });
      if (staff) return;
      await AnalyticsEvent.create(
        [
          {
            eventId,
            day,
            visitor: visitorKey(req, day),
            kind: "download",
            content: String(item._id),
            expiresAt: new Date(Date.now() + 7 * 86400_000),
          },
        ],
        { session },
      );
      await contentModels[kind].updateOne(
        { _id: item._id },
        { $inc: { downloads: 1 } },
        { session },
      );
      await DailyStats.updateOne(
        { day },
        { $inc: { downloads: 1 } },
        { upsert: true, session },
      );
      await metric(day, "download", String(item._id), session);
    });
  } catch (e: any) {
    if (e.code !== 11000) throw e;
  } finally {
    await session.endSession();
  }
}
export const analyticsRouter = Router();
analyticsRouter.post(
  "/analytics/events",
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  optionalUser,
  async (req: AuthRequest, res) => {
    const input = z
      .object({ events: z.array(eventInput).min(1).max(20) })
      .strict()
      .parse(req.body);
    await recordBatch(req, input.events);
    res.status(202);
    ok(res, { accepted: true });
  },
);
const counters = [
  "visitors",
  "pageViews",
  "downloads",
  "contentViews",
  "searches",
] as const;
const dayRange = (days: number, endOffset = 0) =>
  Array.from({ length: days }, (_, i) =>
    dayKey(new Date(Date.now() - (days - 1 - i + endOffset) * 86400_000)),
  );
const objectId = (key: string) => /^[a-f0-9]{24}$/i.test(key);
/** Resolves metric keys to titles with one query per collection. */
async function titles(rows: { kind: string; key: string }[]) {
  const ids = (kinds: string[]) => [
    ...new Set(
      rows
        .filter((r) => kinds.includes(r.kind) && objectId(r.key))
        .map((r) => r.key),
    ),
  ];
  const [papers, notes, subjects] = await Promise.all([
    contentModels.papers
      .find({ _id: { $in: ids(["papers", "download"]) } })
      .select("title slug")
      .lean(),
    contentModels.notes
      .find({ _id: { $in: ids(["notes", "download"]) } })
      .select("title slug")
      .lean(),
    Subject.find({ _id: { $in: ids(["subject"]) } })
      .select("name")
      .lean(),
  ]);
  const map = new Map<
    string,
    { title: string; type?: string; slug?: string }
  >();
  for (const p of papers as any[])
    map.set(String(p._id), { title: p.title, type: "papers", slug: p.slug });
  for (const n of notes as any[])
    map.set(String(n._id), { title: n.title, type: "notes", slug: n.slug });
  for (const s of subjects as any[]) map.set(String(s._id), { title: s.name });
  return map;
}
async function report(days: number) {
  const keys = dayRange(days),
    start = keys[0],
    previousKeys = dayRange(days, days);
  const recent = { day: { $gte: start }, staff: { $ne: true } };
  const [stats, previousStats, grouped, gaps, downloadFacets] =
    await Promise.all([
      DailyStats.find({ day: { $gte: start } })
        .sort({ day: 1 })
        .lean(),
      DailyStats.find({
        day: { $gte: previousKeys[0], $lte: previousKeys.at(-1) },
      }).lean(),
      DailyMetric.aggregate([
        { $match: { day: { $gte: start } } },
        {
          $group: {
            _id: { kind: "$kind", key: "$key" },
            count: { $sum: "$count" },
            zeroResults: { $sum: "$zeroResults" },
          },
        },
        { $sort: { count: -1 } },
        {
          $group: {
            _id: "$_id.kind",
            rows: {
              $push: {
                key: "$_id.key",
                count: "$count",
                zeroResults: "$zeroResults",
              },
            },
          },
        },
        { $project: { rows: { $slice: ["$rows", 20] } } },
      ]),
      DailyMetric.aggregate([
        {
          $match: {
            day: { $gte: start },
            kind: "search",
            zeroResults: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: "$key",
            count: { $sum: "$count" },
            zeroResults: { $sum: "$zeroResults" },
          },
        },
        { $sort: { zeroResults: -1 } },
        { $limit: 15 },
      ]),
      DownloadLog.aggregate([
        { $match: recent },
        {
          $facet: {
            hours: [{ $group: { _id: "$hour", count: { $sum: 1 } } }],
            types: [{ $group: { _id: "$kind", count: { $sum: 1 } } }],
            branches: [
              { $unwind: "$branches" },
              { $group: { _id: "$branches", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            semesters: [
              { $unwind: "$semesters" },
              { $group: { _id: "$semesters", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            downloaders: [
              { $group: { _id: { day: "$day", visitor: "$visitor" } } },
              { $count: "n" },
            ],
          },
        },
      ]),
    ]);
  const timeseries = keys.map((day) => {
    const row: any = stats.find((s) => s.day === day) || {};
    return {
      day,
      ...Object.fromEntries(counters.map((c) => [c, row[c] || 0])),
    } as Record<(typeof counters)[number], number> & { day: string };
  });
  const sum = (rows: any[]) =>
    Object.fromEntries(
      counters.map((c) => [c, rows.reduce((n, r) => n + (r[c] || 0), 0)]),
    );
  const today = timeseries.at(-1),
    yesterday = timeseries.at(-2);
  const breakdown: Record<string, Record<string, number>> = {
    devices: {},
    browsers: {},
    os: {},
    referrers: {},
    countries: {},
  };
  for (const row of stats as any[])
    for (const category of Object.keys(breakdown))
      for (const [key, value] of Object.entries(row[category] || {}))
        breakdown[category][key] =
          (breakdown[category][key] || 0) + Number(value);
  const flat = grouped.flatMap((g) =>
    g.rows.map((r: any) => ({ kind: g._id as string, ...r })),
  );
  const names = await titles(flat);
  const labeled = flat
    .map((row) => {
      const meta = names.get(row.key);
      return {
        kind: row.kind,
        key: row.key,
        title: meta?.title || row.key,
        type: meta?.type,
        slug: meta?.slug,
        count: row.count,
        zeroResults: row.zeroResults,
      };
    })
    .sort((a, b) => b.count - a.count);
  const pick = (kind: string) => labeled.filter((r) => r.kind === kind);
  const facets = downloadFacets[0] || {};
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    downloads: facets.hours?.find((h: any) => h._id === hour)?.count || 0,
  }));
  const counted = (rows: any[] = []) =>
    Object.fromEntries(rows.map((r) => [r._id ?? "Unknown", r.count]));
  return {
    days,
    timeseries,
    today,
    yesterday,
    totals: sum(timeseries),
    previous: sum(previousStats),
    top: labeled,
    lists: {
      downloads: pick("download"),
      viewed: [...pick("papers"), ...pick("notes")]
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      subjects: pick("subject"),
      searches: pick("search"),
      gaps: gaps.map((g) => ({
        title: g._id,
        count: g.count,
        zeroResults: g.zeroResults,
      })),
    },
    downloads: {
      hours,
      types: counted(facets.types),
      branches: counted(facets.branches),
      semesters: counted(facets.semesters),
      uniqueDownloaders: facets.downloaders?.[0]?.n || 0,
    },
    breakdown,
  };
}
const daysParam = z.coerce.number().int().min(1).max(90).default(30);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const logQuery = z.object({
  days: daysParam,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(5).max(100).default(25),
  q: z.string().trim().max(120).optional(),
  kind: z.enum(["papers", "notes"]).optional(),
  audience: z.enum(["all", "students", "staff"]).default("all"),
});
function logFilter(input: z.infer<typeof logQuery>) {
  const filter: any = { day: { $gte: dayRange(input.days)[0] } };
  if (input.kind) filter.kind = input.kind;
  if (input.audience === "students") filter.staff = { $ne: true };
  if (input.audience === "staff") filter.staff = true;
  if (input.q) {
    const pattern = new RegExp(escapeRegex(input.q), "i");
    filter.$or = [
      { title: pattern },
      { subjects: pattern },
      { visitor: pattern },
      { userName: pattern },
    ];
  }
  return filter;
}
const csvCell = (value: unknown) => {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  // Neutralise spreadsheet formulas as well as quoting.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const analyticsAdminRouter = Router();
analyticsAdminRouter.get("/analytics", async (req, res) => {
  ok(res, await report(daysParam.parse(req.query.days)));
});
analyticsAdminRouter.get("/analytics/downloads", async (req, res) => {
  const input = logQuery.parse(req.query),
    filter = logFilter(input);
  const [rows, total] = await Promise.all([
    DownloadLog.find(filter)
      .sort({ at: -1 })
      .skip((input.page - 1) * input.limit)
      .limit(input.limit)
      .select("-expiresAt -__v")
      .lean(),
    DownloadLog.countDocuments(filter),
  ]);
  ok(res, {
    rows,
    total,
    page: input.page,
    pages: Math.max(1, Math.ceil(total / input.limit)),
  });
});
analyticsAdminRouter.get("/analytics/downloads.csv", async (req, res) => {
  const input = logQuery.parse(req.query);
  const rows: any[] = await DownloadLog.find(logFilter(input))
    .sort({ at: -1 })
    .limit(10_000)
    .lean();
  const columns = [
    "time_ist",
    "type",
    "title",
    "subjects",
    "branches",
    "semesters",
    "year",
    "downloaded_by",
    "device",
    "os",
    "browser",
    "country",
    "page",
  ];
  const time = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    dateStyle: "short",
    timeStyle: "medium",
    hourCycle: "h23",
  });
  const lines = [
    columns.join(","),
    ...rows.map((r) =>
      [
        time.format(r.at),
        r.kind,
        r.title,
        r.subjects,
        r.branches,
        r.semesters,
        r.year,
        r.staff
          ? `${r.userName || "Staff"} (${r.userRole || "staff"})`
          : `Visitor ${r.visitor}`,
        r.device,
        r.os,
        r.browser,
        r.country,
        r.page,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  res
    .set({
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="buit-downloads.csv"',
    })
    .send(lines.join("\n"));
});
analyticsAdminRouter.get("/analytics/export.csv", async (req, res) => {
  const data = await report(daysParam.parse(req.query.days));
  const rows = [
    "day,visitors,page_views,resource_views,searches,downloads",
    ...data.timeseries.map(
      (row) =>
        `${row.day},${row.visitors},${row.pageViews},${row.contentViews},${row.searches},${row.downloads}`,
    ),
  ];
  res
    .set({
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="buit-analytics.csv"',
    })
    .send(rows.join("\n"));
});
