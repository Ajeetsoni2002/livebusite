import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSnapshot } from "../src/lib/snapshot.ts";
const saved = JSON.parse(
  readFileSync(new URL("../public/snapshot.json", import.meta.url), "utf8"),
);
test("saved library can search by real subject name and offer real year suggestions", () => {
  const paper = saved.papers.find(
    (paper: any) => paper.offerings.length && paper.year,
  );
  const result = readSnapshot<any[]>(saved, "/papers", {
    q: paper.offerings[0].subject.name,
  });
  assert.ok(result.data.some((item) => item._id === paper._id));
  const suggestions = readSnapshot<any[]>(saved, "/search/suggestions", {
    q: String(paper.year),
  });
  assert.ok(suggestions.data.some((item) => item.name));
});
test("saved related papers have an array shape and matching subject offerings", () => {
  const paper = saved.papers.find((paper: any) => paper.offerings.length);
  const result = readSnapshot<any[]>(saved, `/papers/${paper._id}/related`);
  assert.ok(Array.isArray(result.data));
  assert.ok(
    result.data.every(
      (item) =>
        item._id !== paper._id &&
        item.offerings.some((offering: any) =>
          paper.offerings.some((own: any) => own._id === offering._id),
        ),
    ),
  );
});
