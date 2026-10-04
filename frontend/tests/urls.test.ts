import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiUrl } from "../src/lib/urls.ts";
test("signed storage URLs remain unchanged with production API configuration", () => {
  const url =
    "https://bucket.example.test/paper.pdf?X-Amz-Signature=abc&X-Amz-Expires=120";
  assert.equal(resolveApiUrl(url, "https://api.example.test/api"), url);
  assert.equal(resolveApiUrl(url), url);
});
test("local and deployed PDF gateways resolve against the API origin", () => {
  assert.equal(
    resolveApiUrl("/api/files/signed", "https://api.example.test/api"),
    "https://api.example.test/api/files/signed",
  );
  assert.equal(
    resolveApiUrl("/papers/id/preview", "https://api.example.test/api"),
    "https://api.example.test/api/papers/id/preview",
  );
  assert.equal(resolveApiUrl("/api/files/signed"), "/api/files/signed");
});
