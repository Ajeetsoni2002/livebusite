import { test } from "node:test";
import assert from "node:assert/strict";
test("content rejects invalid moderation state and preserves shared offerings", async () => {
  const { Paper, SubjectOffering } = await import("../src/modules/models.js");
  const paper = new Paper({ title: "Existing paper", status: "invented" });
  await assert.rejects(paper.validate(), /status/);
  assert.ok(SubjectOffering.schema.path("branch"));
  assert.ok(Paper.schema.path("offerings"));
});
test("file hashes and daily uniqueness have unique indexes; raw events expire", async () => {
  const { FileAsset, DailyVisitor, AnalyticsEvent } =
    await import("../src/modules/models.js");
  assert.ok(
    FileAsset.schema
      .indexes()
      .some(([keys, options]) => keys.hash && options.unique),
  );
  assert.ok(
    DailyVisitor.schema
      .indexes()
      .some(([keys, options]) => keys.day && keys.visitor && options.unique),
  );
  assert.ok(
    AnalyticsEvent.schema
      .indexes()
      .some(([, options]) => options.expireAfterSeconds === 0),
  );
});
