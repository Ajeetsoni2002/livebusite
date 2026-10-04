import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { resolve } from "node:path";
test("PDF validation rejects renamed text and malformed PDF bytes", async () => {
  const { validatePdf } = await import("../src/storage/index.js");
  await assert.rejects(
    validatePdf(Buffer.from("not a pdf"), "application/pdf"),
    /PDF/,
  );
  await assert.rejects(
    validatePdf(Buffer.from("%PDF-1.7\ninvalid"), "application/pdf"),
    /PDF/,
  );
  const document = await PDFDocument.create();
  document.addPage();
  const bytes = Buffer.from(await document.save());
  await assert.rejects(validatePdf(bytes, "text/plain"), /PDF/);
  assert.equal(
    (await validatePdf(bytes, "application/pdf")).size,
    bytes.length,
  );
});
test("local storage rejects traversal and serves correct byte ranges", async () => {
  const { LocalStorage } = await import("../src/storage/local.js");
  const store = new LocalStorage(resolve(".npm-cache/test-storage"));
  await assert.rejects(
    store.put("../escape.pdf", Buffer.from("x"), "application/pdf"),
    /key/,
  );
  await store.put(
    "test/range.pdf",
    Buffer.from("0123456789"),
    "application/pdf",
  );
  const object = await store.get("test/range.pdf", { start: 2, end: 5 });
  let bytes = "";
  for await (const chunk of object.body) bytes += chunk.toString();
  assert.equal(bytes, "2345");
  assert.equal(object.size, 4);
  await store.delete("test/range.pdf");
});

test("thumbnail rendering failures and timeouts return a fallback without blocking the next PDF", async () => {
  const { renderPdfThumbnail } = await import("../src/storage/thumbnail.js");
  const document = await PDFDocument.create();
  document.addPage();
  const bytes = Buffer.from(await document.save());
  assert.equal(await renderPdfThumbnail(Buffer.from("broken PDF")), null);
  assert.equal(await renderPdfThumbnail(bytes, 1), null);
  assert.ok(
    await renderPdfThumbnail(bytes),
    "a timeout must not leave rendering permanently busy",
  );
});
