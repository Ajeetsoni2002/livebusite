import { createHash, randomUUID } from "node:crypto";
import { contentModels, FileAsset, ProcessingJob } from "../modules/models.js";
import { storage } from "../storage/index.js";
import {
  ensureThumbnail,
  THUMBNAIL_VERSION,
  thumbnailMaxBytes,
} from "../storage/thumbnail.js";
import {
  AlreadyWatermarked,
  getWatermarkSettings,
  renderWatermarkText,
  watermarkPdf,
} from "./watermark.js";

/*
 * A small MongoDB-backed queue (no Redis on the free plan). One job at a time, a lease
 * that a crashed or sleeping instance gives up automatically, three attempts with backoff.
 * Jobs are idempotent: re-running one recomputes the same output from the stored source.
 */
const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
type Kind = "papers" | "notes";

async function readAll(key: string) {
  const { body } = await storage.get(key);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function enqueueWatermark(
  contentType: Kind,
  content: unknown,
  options: { requestedBy?: unknown; batch?: string; hold?: boolean } = {},
) {
  const pending = await ProcessingJob.findOne({
    type: "watermark",
    content,
    status: "queued",
  });
  if (pending) {
    if (options.batch) await pending.updateOne({ batch: options.batch });
  } else
    await ProcessingJob.create({
      type: "watermark",
      contentType,
      content,
      requestedBy: options.requestedBy,
      batch: options.batch,
    });
  await contentModels[contentType].updateOne(
    { _id: content },
    {
      $set: {
        "watermark.status": "queued",
        ...(options.hold ? { "watermark.hold": true } : {}),
      },
      $unset: { "watermark.error": "" },
    },
  );
  kickJobs();
}

async function watermarkJob(job: any) {
  const model = contentModels[job.contentType as Kind];
  const item: any = await model
    .findById(job.content)
    .populate({ path: "offerings", populate: { path: "subject" } });
  if (!item || item.deletedAt) return;
  if (!item.files?.original && !item.asset) {
    item.watermark = { status: "none" };
    await item.save();
    return;
  }
  // Legacy items predate versioned files: their current asset is the original.
  if (!item.files) item.files = {};
  if (!item.files.original) item.files.original = item.asset;
  const active =
    item.activeVersion === "processed" && item.files.processed
      ? "processed"
      : "original";
  const sourceId = item.files[active];
  const { settings, revision } = await getWatermarkSettings();
  const subject = item.offerings?.[0]?.subject;
  const text = renderWatermarkText(settings.template, subject?.code);
  await model.updateOne(
    { _id: item._id },
    { $set: { "watermark.status": "running" } },
  );
  const finish = async (watermark: object, asset = sourceId) => {
    item.asset = asset;
    item.watermark = { ...watermark, hold: false };
    await item.save();
  };
  if (!settings.enabled || !text)
    return finish({
      status: "skipped",
      reason: settings.enabled ? "empty-text" : "disabled",
      revision,
    });
  const signature = `${revision}|${text}`;
  const cached = item.files.watermarked?.[active];
  if (
    cached &&
    item.files.watermarked?.[`${active}Signature`] === signature &&
    (await FileAsset.exists({ _id: cached, deletedAt: null }))
  )
    return finish(
      { status: "done", text, revision, appliedAt: new Date() },
      cached,
    );
  const source: any = await FileAsset.findById(sourceId);
  if (!source) throw new Error("Source file is missing");
  let output: Buffer;
  try {
    output = await watermarkPdf(await readAll(source.key), {
      ...settings,
      text,
      title: subject
        ? `${subject.name}${item.year ? ` ${item.year}` : ""}`
        : item.title,
    });
  } catch (error) {
    if (error instanceof AlreadyWatermarked)
      return finish({
        status: "skipped",
        reason: "already-watermarked",
        revision,
      });
    throw error;
  }
  const hash = createHash("sha256").update(output).digest("hex");
  let asset: any = await FileAsset.findOne({ hash });
  if (!asset) {
    const key = `watermarked/${randomUUID()}.pdf`;
    await storage.put(key, output, "application/pdf", true);
    try {
      asset = await FileAsset.create({
        key,
        hash,
        size: output.length,
        mime: "application/pdf",
        originalName: source.originalName,
        // The watermark is faint; the source's cover thumbnail stays representative.
        thumbnailKey: source.thumbnailKey,
        thumbnailVersion: source.thumbnailVersion,
      });
    } catch (error: any) {
      await storage.delete(key).catch(() => {});
      if (error.code !== 11000) throw error;
      asset = await FileAsset.findOne({ hash });
    }
  }
  item.files.watermarked = {
    ...(item.files.watermarked?.toObject?.() || item.files.watermarked || {}),
    [active]: asset._id,
    [`${active}Signature`]: signature,
  };
  await finish(
    { status: "done", text, revision, appliedAt: new Date() },
    asset._id,
  );
}

async function thumbnailJob(job: any) {
  const item: any = await contentModels[job.contentType as Kind].findById(
    job.content,
  );
  if (!item?.asset) return;
  const asset: any = await FileAsset.findById(item.asset);
  if (!asset || asset.deletedAt) return;
  if (asset.thumbnailKey) {
    try {
      await storage.head(asset.thumbnailKey);
      if (asset.thumbnailVersion === THUMBNAIL_VERSION) return;
    } catch {
      await FileAsset.updateMany(
        { thumbnailKey: asset.thumbnailKey },
        { $unset: { thumbnailKey: "", thumbnailVersion: "" } },
      );
      asset.thumbnailKey = undefined;
    }
  }
  const bytes = await readAll(asset.key);
  if (bytes.length > thumbnailMaxBytes)
    throw new Error("PDF is too large for a thumbnail");
  if (!(await ensureThumbnail(asset, bytes, storage, 60_000)))
    throw new Error("Thumbnail rendering failed");
}

export async function enqueueJob(
  type: "thumbnail",
  contentType: Kind,
  content: unknown,
  options: { requestedBy?: unknown; batch?: string } = {},
) {
  if (!(await ProcessingJob.exists({ type, content, status: "queued" })))
    await ProcessingJob.create({ type, contentType, content, ...options });
  kickJobs();
}

/**
 * Queues a thumbnail job for every live PDF whose asset has no cover yet, or a cover
 * from an older renderer, so imported and older items heal without an admin pressing
 * "repair". Items with a pending job, or whose job failed in the last week, are left alone.
 */
export async function queueMissingThumbnails(limit = 500) {
  let queued = 0;
  for (const [kind, model] of Object.entries(contentModels) as [Kind, any][]) {
    const rows = await model
      .find({
        deletedAt: null,
        asset: { $ne: null },
        format: { $ne: "markdown" },
      })
      .select("_id asset")
      .lean();
    if (!rows.length) continue;
    const missing = new Set(
      (
        await FileAsset.find({
          _id: { $in: rows.map((r: any) => r.asset) },
          deletedAt: null,
          $or: [
            { thumbnailKey: { $in: [null, ""] } },
            { thumbnailVersion: { $ne: THUMBNAIL_VERSION } },
          ],
        })
          .select("_id")
          .lean()
      ).map((a: any) => String(a._id)),
    );
    const candidates = rows.filter((r: any) => missing.has(String(r.asset)));
    if (!candidates.length) continue;
    const busy = new Set(
      (
        await ProcessingJob.find({
          type: "thumbnail",
          content: { $in: candidates.map((r: any) => r._id) },
          $or: [
            { status: { $in: ["queued", "running"] } },
            {
              status: "failed",
              finishedAt: { $gte: new Date(Date.now() - 7 * 86_400_000) },
            },
          ],
        })
          .select("content")
          .lean()
      ).map((j: any) => String(j.content)),
    );
    for (const row of candidates) {
      if (queued >= limit) break;
      if (busy.has(String(row._id))) continue;
      await ProcessingJob.create({
        type: "thumbnail",
        contentType: kind,
        content: row._id,
      });
      queued++;
    }
  }
  if (queued) kickJobs();
  return queued;
}

/** Runs the sweep shortly after start and then every few hours. */
export function startThumbnailSweep(everyMs = 6 * 3600_000, firstMs = 30_000) {
  const sweep = () =>
    queueMissingThumbnails()
      .then((n) => n && console.info(`Queued ${n} missing thumbnails`))
      .catch(() => console.warn("Thumbnail sweep failed; will retry later."));
  const first = setTimeout(sweep, firstMs);
  const timer = setInterval(sweep, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

const handlers: Record<string, (job: any) => Promise<void>> = {
  watermark: watermarkJob,
  thumbnail: thumbnailJob,
};

/** Claims and runs one due job. Returns false when the queue is empty. */
export async function runNextJob() {
  const now = new Date();
  const job: any = await ProcessingJob.findOneAndUpdate(
    {
      $or: [
        { status: "queued", runAfter: { $lte: now } },
        { status: "running", leaseUntil: { $lt: now } },
      ],
    },
    {
      $set: {
        status: "running",
        startedAt: now,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
  if (!job) return false;
  const started = Date.now();
  const heartbeat = setInterval(() => {
    ProcessingJob.updateOne(
      { _id: job._id },
      { leaseUntil: new Date(Date.now() + LEASE_MS) },
    ).catch(() => {});
  }, 60_000);
  heartbeat.unref();
  try {
    await handlers[job.type](job);
    await job.updateOne({
      status: "done",
      finishedAt: new Date(),
      durationMs: Date.now() - started,
      $unset: { error: "" },
    });
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 300);
    const failed = job.attempts >= MAX_ATTEMPTS;
    await job.updateOne({
      status: failed ? "failed" : "queued",
      error: message,
      runAfter: new Date(Date.now() + 60_000 * job.attempts),
      ...(failed ? { finishedAt: new Date() } : {}),
    });
    // A failed first watermark keeps the hold: the public never gets an unmarked file.
    if (job.type === "watermark")
      await contentModels[job.contentType as Kind].updateOne(
        { _id: job.content },
        {
          $set: {
            "watermark.status": failed ? "failed" : "queued",
            "watermark.error": message,
          },
        },
      );
  } finally {
    clearInterval(heartbeat);
    console.info(
      JSON.stringify({
        job: job.type,
        id: String(job._id),
        attempt: job.attempts,
        ms: Date.now() - started,
      }),
    );
  }
  return true;
}

let busy = false,
  timer: NodeJS.Timeout | undefined;
async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (await runNextJob());
  } catch (error) {
    console.error("Job runner error", (error as Error)?.message);
  } finally {
    busy = false;
  }
}
export function kickJobs() {
  if (timer) setImmediate(() => void drain());
}
export function startJobRunner(intervalMs = 5_000) {
  // Jobs orphaned by a restart are picked up again once their lease runs out.
  timer = setInterval(() => void drain(), intervalMs);
  timer.unref();
  void drain();
  return () => {
    clearInterval(timer);
    timer = undefined;
  };
}
