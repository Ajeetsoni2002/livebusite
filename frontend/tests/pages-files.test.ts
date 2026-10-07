import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/files/[[path]].ts";

const key = "watermarked/12345678-1234-4234-8234-123456789abc.pdf";
const thumb = "thumbnails/12345678-1234-4234-8234-123456789abc.webp";
function bucket(
  objects: Record<string, { metadata?: Record<string, string> }>,
) {
  return {
    async get(name: string, options?: { range?: Headers }) {
      const found = objects[name];
      if (!found) return null;
      const bytes = new TextEncoder().encode("%PDF-1.7 public");
      const ranged = options?.range?.get("Range") === "bytes=0-4";
      return {
        body: new Blob([ranged ? bytes.slice(0, 5) : bytes]).stream(),
        size: bytes.length,
        httpEtag: '"e1"',
        range: ranged ? { offset: 0, length: 5 } : undefined,
        customMetadata: found.metadata,
      };
    },
  };
}
const ask = (path: string, FILES?: any, headers: HeadersInit = {}) =>
  onRequest({
    request: new Request("https://site.test/files/" + path, { headers }),
    env: { FILES },
  });

test("without the R2 binding the route is a plain 404 (the app falls back to the API)", async () => {
  assert.equal((await ask(key)).status, 404);
});

test("only public watermarked PDFs and thumbnails are served, with immutable caching", async () => {
  const FILES = bucket({
    [key]: { metadata: { visibility: "public" } },
    [thumb]: {},
  });
  const pdf = await ask(key, FILES);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
  assert.match(pdf.headers.get("Cache-Control") || "", /immutable/);
  assert.equal(await pdf.text(), "%PDF-1.7 public");
  assert.equal(
    (await ask(thumb, FILES)).headers.get("Content-Type"),
    "image/webp",
  );
  const range = await ask(key, FILES, { Range: "bytes=0-4" });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("Content-Range"), "bytes 0-4/15");
});

test("originals, unmarked PDFs and odd keys are never served", async () => {
  const FILES = bucket({
    [key]: {},
    "uploads/12345678-1234-4234-8234-123456789abc.pdf": {
      metadata: { visibility: "public" },
    },
  });
  assert.equal((await ask(key, FILES)).status, 404);
  assert.equal(
    (await ask("uploads/12345678-1234-4234-8234-123456789abc.pdf", FILES))
      .status,
    404,
  );
  assert.equal((await ask("watermarked/../uploads/x.pdf", FILES)).status, 404);
});
