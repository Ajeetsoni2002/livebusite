// Records each existing item's current PDF as its original version. Non-destructive
// and idempotent: no file is touched or deleted. Dry run by default; pass --apply to write.
// Afterwards, use Admin → Watermark → "Apply to all" to watermark the old items.
import mongoose from "mongoose";
import { config } from "../src/config.js";
import { contentModels } from "../src/modules/models.js";

const apply = process.argv.includes("--apply");
await mongoose.connect(config.mongoUri);
try {
  for (const [kind, model] of Object.entries(contentModels)) {
    const filter = {
      asset: { $ne: null },
      "files.original": { $exists: false },
    };
    const count = await model.countDocuments(filter);
    if (apply && count)
      await model.updateMany(filter, [
        {
          $set: {
            files: { original: "$asset" },
            activeVersion: "original",
            watermark: { status: "none", hold: false },
          },
        },
      ]);
    console.info(
      `${kind}: ${count} item(s) ${apply ? "migrated" : "to migrate"}`,
    );
  }
  if (!apply) console.info("Dry run only. Re-run with --apply to write.");
} finally {
  await mongoose.disconnect();
}
