import mongoose from "mongoose";
import { config } from "../src/config.js";
import { FileAsset } from "../src/modules/models.js";
import { storage } from "../src/storage/index.js";
import {
  ensureThumbnail,
  thumbnailMaxBytes,
} from "../src/storage/thumbnail.js";

await mongoose.connect(config.mongoUri);
const counts = { generated: 0, skipped: 0, failed: 0 };
try {
  const cursor = FileAsset.find({
    deletedAt: null,
    thumbnailKey: { $in: [null, ""] },
  })
    .sort({ _id: 1 })
    .cursor();
  for await (const asset of cursor) {
    if (asset.size > thumbnailMaxBytes) {
      counts.skipped++;
      continue;
    }
    try {
      const object = await storage.get(asset.key);
      if (object.size > thumbnailMaxBytes) {
        object.body.destroy();
        counts.skipped++;
        continue;
      }
      const timer = setTimeout(
        () => object.body.destroy(new Error("Thumbnail read timed out")),
        15_000,
      );
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of object.body) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > thumbnailMaxBytes)
            throw new Error("Thumbnail read exceeds limit");
          chunks.push(bytes);
        }
      } finally {
        clearTimeout(timer);
        object.body.destroy();
      }
      if (await ensureThumbnail(asset, Buffer.concat(chunks), storage))
        counts.generated++;
      else counts.failed++;
    } catch {
      counts.failed++;
    }
  }
  console.info(
    `Thumbnails: ${counts.generated} generated, ${counts.skipped} oversized PDFs skipped, ${counts.failed} unavailable. Original PDFs are unchanged.`,
  );
  if (counts.failed) process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
