import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/api/[[path]].ts";

const origin = "https://livebusite.pages.dev";
const upstream = "https://buit-papers-api.onrender.com";
const env = { API_ORIGIN: upstream };

test("proxy rejects missing or invalid upstream configuration without making a request", async (t) => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response(),
  );
  t.after(() => fetchMock.mock.restore());
  for (const API_ORIGIN of [
    undefined,
    "http://backend.test",
    upstream + "/api",
    "https://user:password@backend.test",
    origin,
  ]) {
    const response = await onRequest({
      request: new Request(origin + "/api/health"),
      env: { API_ORIGIN },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("login forwards cookies, CSRF, origin and body and preserves separate auth cookies", async (t) => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (request: Request, options: RequestInit) => {
      assert.equal(request.url, upstream + "/api/auth/login?next=admin");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("Cookie"), "csrf=test-token");
      assert.equal(request.headers.get("X-CSRF-Token"), "test-token");
      assert.equal(request.headers.get("Origin"), origin);
      assert.equal(request.headers.get("Host"), null);
      assert.deepEqual(await request.json(), {
        email: "admin@example.test",
        password: "test password",
      });
      assert.equal(options.redirect, "manual");
      assert.equal(options.cache, "no-store");
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.append(
        "Set-Cookie",
        "access=one; Path=/api; HttpOnly; Secure; SameSite=Lax",
      );
      headers.append(
        "Set-Cookie",
        "refresh=two; Path=/api; HttpOnly; Secure; SameSite=Lax",
      );
      return new Response('{"data":{"role":"admin"}}', { headers });
    },
  );
  t.after(() => fetchMock.mock.restore());
  const request = new Request(origin + "/api/auth/login?next=admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "csrf=test-token",
      "X-CSRF-Token": "test-token",
      Origin: origin,
      Host: "livebusite.pages.dev",
    },
    body: JSON.stringify({
      email: "admin@example.test",
      password: "test password",
    }),
  });
  const response = await onRequest({ request, env });
  assert.equal(response.status, 200);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.deepEqual(await response.json(), { data: { role: "admin" } });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("preview returns signed R2 redirects without following them", async (t) => {
  const signed =
    "https://bucket.r2.cloudflarestorage.com/paper.pdf?X-Amz-Signature=test";
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (_request: Request, options: RequestInit) => {
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: signed } });
    },
  );
  t.after(() => fetchMock.mock.restore());
  const response = await onRequest({
    request: new Request(origin + "/api/papers/id/preview"),
    env,
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), signed);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("redirects to the backend API stay on the frontend proxy origin", async (t) => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(null, {
        status: 307,
        headers: { Location: upstream + "/api/files/signed?attachment=1" },
      }),
  );
  t.after(() => fetchMock.mock.restore());
  const response = await onRequest({
    request: new Request(origin + "/api/papers/id/preview"),
    env,
  });
  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("Location"),
    origin + "/api/files/signed?attachment=1",
  );
});

test("PDF byte ranges preserve status, bytes and content headers", async (t) => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (request: Request) => {
      assert.equal(request.headers.get("Range"), "bytes=0-3");
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 206,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Range": "bytes 0-3/100",
          "Content-Length": "4",
          "Accept-Ranges": "bytes",
        },
      });
    },
  );
  t.after(() => fetchMock.mock.restore());
  const response = await onRequest({
    request: new Request(origin + "/api/files/signed", {
      headers: { Range: "bytes=0-3" },
    }),
    env,
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 0-3/100");
  assert.equal(response.headers.get("Content-Length"), "4");
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([37, 80, 68, 70]),
  );
});

test("multipart uploads preserve boundaries, bytes and request action headers", async (t) => {
  const form = new FormData();
  form.set("title", "Uploaded paper");
  form.set(
    "file",
    new Blob(["%PDF-test"], { type: "application/pdf" }),
    "paper.pdf",
  );
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (request: Request) => {
      assert.match(
        request.headers.get("Content-Type")!,
        /multipart\/form-data; boundary=/,
      );
      assert.equal(request.headers.get("Idempotency-Key"), "unique-action");
      const forwarded = await request.formData();
      assert.equal(forwarded.get("title"), "Uploaded paper");
      assert.equal(await (forwarded.get("file") as File).text(), "%PDF-test");
      return new Response(null, { status: 201 });
    },
  );
  t.after(() => fetchMock.mock.restore());
  const response = await onRequest({
    request: new Request(origin + "/api/admin/papers", {
      method: "POST",
      body: form,
      headers: { "Idempotency-Key": "unique-action" },
    }),
    env,
  });
  assert.equal(response.status, 201);
});

test("upstream auth failures keep their status and errors and cannot be cached", async (t) => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response('{"error":{"code":"CSRF_REQUIRED"}}', {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        },
      }),
  );
  t.after(() => fetchMock.mock.restore());
  const response = await onRequest({
    request: new Request(origin + "/api/auth/login", { method: "POST" }),
    env,
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await response.json()).error.code, "CSRF_REQUIRED");
});

test("network failures produce a retryable 502 without exposing upstream details", async (t) => {
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("private internal error");
  });
  t.after(() => fetchMock.mock.restore());
  const response = await onRequest({
    request: new Request(origin + "/api/health"),
    env,
  });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.doesNotMatch(await response.text(), /private internal error/);
});
