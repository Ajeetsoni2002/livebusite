import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { FileAsset } from "../modules/models.js";

export const thumbnailMaxBytes = 20 * 1024 * 1024;
let rendering = false;

// A separate process keeps slow or broken PDFs away from the API event loop.
// Bulk uploads fall back to an icon when this process is busy; the backfill retries them.
export async function renderPdfThumbnail(
  bytes: Buffer,
  timeoutMs = 10_000,
): Promise<Buffer | null> {
  if (rendering || !bytes.length || bytes.length > thumbnailMaxBytes)
    return null;
  rendering = true;
  try {
    return await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=128",
          fileURLToPath(new URL("./thumbnail-worker.mjs", import.meta.url)),
        ],
        { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
      );
      const chunks: Buffer[] = [];
      let length = 0,
        finished = false;
      const finish = (result: Buffer | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        child.stdin.destroy();
        child.stdout.destroy();
        if (child.exitCode === null) child.kill();
        resolve(result);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      child.once("error", () => finish(null));
      child.stdin.on("error", () => finish(null));
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 512 * 1024) return finish(null);
        chunks.push(chunk);
      });
      child.once("close", (code) => {
        const image = Buffer.concat(chunks);
        finish(
          code === 0 &&
            image.toString("ascii", 0, 4) === "RIFF" &&
            image.toString("ascii", 8, 12) === "WEBP"
            ? image
            : null,
        );
      });
      child.stdin.end(bytes);
    });
  } finally {
    rendering = false;
  }
}

interface ThumbnailStorage {
  put(
    key: string,
    bytes: Buffer,
    mime: string,
    publicObject?: boolean,
  ): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}
export async function ensureThumbnail(
  asset: any,
  bytes: Buffer,
  store: ThumbnailStorage,
  timeoutMs = 10_000,
) {
  if (asset.thumbnailKey) return true;
  let key: string;
  try {
    const image = await renderPdfThumbnail(bytes, timeoutMs);
    if (!image) return false;
    key = `thumbnails/${randomUUID()}.webp`;
    await store.put(key, image, "image/webp", true);
    const updated = await FileAsset.findOneAndUpdate(
      { _id: asset._id, deletedAt: null, thumbnailKey: { $in: [null, ""] } },
      { $set: { thumbnailKey: key } },
      { returnDocument: "after" },
    );
    if (!updated) {
      await store.delete(key);
      return false;
    }
    asset.thumbnailKey = key;
    return true;
  } catch {
    if (key) await store.delete(key).catch(() => {});
    return false;
  }
}
