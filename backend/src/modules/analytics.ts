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
export function visitorKey(req: AuthRequest, day = dayKey()) {
  return createHmac("sha256", config.analyticsSecret)
    .update(`${day}|${req.ip || ""}|${req.get("User-Agent") || ""}`)
    .digest("hex");
}
export function excluded(req: AuthRequest) {
  return (
    !!req.user ||
    !!req.cookies?.refresh ||
    req.get("DNT") === "1" ||
    /bot|crawler|spider|headless|preview|slurp|curl|wget|python-requests/i.test(
      req.get("User-Agent") || "",
    )
  );
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
    ua = req.get("User-Agent") || "";
  const device = /mobile|android|iphone/i.test(ua)
    ? "mobile"
    : /ipad|tablet/i.test(ua)
      ? "tablet"
      : "desktop";
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /firefox/i.test(ua)
      ? "Firefox"
      : /chrome|crios/i.test(ua)
        ? "Chrome"
        : /safari/i.test(ua)
          ? "Safari"
          : "Other";
  const country =
    config.cfOriginSecret &&
    req.get("X-Origin-Verify") === config.cfOriginSecret &&
    /^[A-Z]{2}$/.test(req.get("CF-IPCountry") || "")
      ? req.get("CF-IPCountry")
      : "Unknown";
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
          increment[`countries.${country}`] = 1;
          increment[`referrers.${referrer}`] = 1;
        }
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
export async function recordDownload(
  req: AuthRequest,
  item: any,
  kind: string,
  eventId: string,
) {
  if (excluded(req)) return;
  const session = await mongoose.startSession();
  const day = dayKey();
  try {
    await session.withTransaction(async () => {
      await AnalyticsEvent.create(
        [
          {
            eventId,
            day,
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
      if (!excluded(req)) {
        await DailyStats.updateOne(
          { day },
          { $inc: { downloads: 1 } },
          { upsert: true, session },
        );
        await metric(day, "download", String(item._id), session);
      }
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
async function report(days: number) {
  const keys = Array.from({ length: days }, (_, i) =>
      dayKey(new Date(Date.now() - (days - 1 - i) * 86400_000)),
    ),
    start = keys[0];
  const [stats, top] = await Promise.all([
    DailyStats.find({ day: { $gte: start } })
      .sort({ day: 1 })
      .lean(),
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
      { $limit: 100 },
    ]),
  ]);
  const timeseries = keys.map(
    (day) =>
      stats.find((s) => s.day === day) || {
        day,
        visitors: 0,
        pageViews: 0,
        downloads: 0,
      },
  );
  const today = timeseries.at(-1),
    yesterday = timeseries.at(-2);
  const breakdown: Record<string, Record<string, number>> = {
    devices: {},
    browsers: {},
    referrers: {},
    countries: {},
  };
  for (const row of stats)
    for (const category of Object.keys(breakdown))
      for (const [key, value] of Object.entries(row[category] || {}))
        breakdown[category][key] =
          (breakdown[category][key] || 0) + Number(value);
  const labeled = await Promise.all(
    top.map(async (row) => {
      const kind = row._id.kind,
        key = row._id.key;
      let title = key;
      if (["papers", "notes", "download"].includes(kind)) {
        title =
          (
            await (
              kind === "notes" ? contentModels.notes : contentModels.papers
            )
              .findById(key)
              .select("title")
              .lean()
          )?.title || key;
        if (kind === "download" && title === key)
          title =
            (await contentModels.notes.findById(key).select("title").lean())
              ?.title || key;
      }
      if (kind === "subject") {
        const { Subject } = await import("./models.js");
        title =
          (await Subject.findById(key).select("name").lean())?.name || key;
      }
      return {
        kind,
        key,
        title,
        count: row.count,
        zeroResults: row.zeroResults,
      };
    }),
  );
  return { timeseries, today, yesterday, top: labeled, breakdown };
}
export const analyticsAdminRouter = Router();
analyticsAdminRouter.get("/analytics", async (req, res) => {
  const days = z.coerce
    .number()
    .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
    .default(30)
    .parse(req.query.days);
  ok(res, await report(days));
});
analyticsAdminRouter.get("/analytics/export.csv", async (req, res) => {
  const days = z.coerce
      .number()
      .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
      .default(30)
      .parse(req.query.days),
    data = await report(days);
  const rows = [
    "day,visitors,page_views,downloads",
    ...data.timeseries.map(
      (row) => `${row.day},${row.visitors},${row.pageViews},${row.downloads}`,
    ),
  ];
  res
    .set({
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="buit-analytics.csv"',
    })
    .send(rows.join("\n"));
});
