const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function failure(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

// A sleeping Render service answers with its own HTML page. Visitors must never
// see foreign HTML, so the proxy turns any HTML answer into our JSON 503.
function wakingUp() {
  const response = failure(
    503,
    "WAKING_UP",
    "The library is waking up. This usually takes under a minute.",
  );
  response.headers.set("Retry-After", "10");
  return response;
}

const previewPath = /^\/api\/(papers|notes)\/[^/]+\/preview$/;

// The in-page PDF viewer asks for ?stream=1: follow the storage redirect here so
// the browser reads the PDF same-origin (no bucket CORS) and only ever gets a PDF.
async function streamPdf(target: URL, original: Request, sameOrigin: boolean) {
  const headers = new Headers({ Accept: "application/pdf" });
  const range = original.headers.get("Range");
  if (range) headers.set("Range", range);
  const cookie = original.headers.get("Cookie");
  if (sameOrigin && cookie) headers.set("Cookie", cookie);
  const file = await fetch(target.href, {
    headers,
    redirect: "manual",
    cache: "no-store",
  });
  const type = (file.headers.get("Content-Type") || "").toLowerCase();
  if (
    (file.status !== 200 && file.status !== 206) ||
    !type.includes("application/pdf")
  ) {
    await file.body?.cancel();
    return failure(
      502,
      "PREVIEW_UNAVAILABLE",
      "The preview could not be loaded. Please try again.",
    );
  }
  const out = new Headers({
    "Content-Type": "application/pdf",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of [
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "Content-Disposition",
    "ETag",
    "Last-Modified",
  ]) {
    const value = file.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(file.body, { status: file.status, headers: out });
}

export async function onRequest(context: {
  request: Request;
  env: { API_ORIGIN?: string };
}): Promise<Response> {
  const incoming = new URL(context.request.url);
  let upstream: URL;
  try {
    upstream = new URL(context.env.API_ORIGIN || "");
    if (
      upstream.protocol !== "https:" ||
      upstream.username ||
      upstream.password ||
      upstream.pathname !== "/" ||
      upstream.search ||
      upstream.hash ||
      upstream.origin === incoming.origin
    )
      throw new Error("Invalid API origin");
  } catch {
    return failure(
      503,
      "PROXY_CONFIG_REQUIRED",
      "The API connection is not configured.",
    );
  }
  if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/")) {
    return failure(404, "NOT_FOUND", "API route not found.");
  }

  // Keep the configured host fixed; a path or query can never choose another host.
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  const request = new Request(upstream.href, context.request);
  request.headers.delete("host");
  for (const header of hopHeaders) request.headers.delete(header);

  try {
    // Preserve Cookie, Origin, CSRF, upload bodies and range requests. Do not
    // follow PDF redirects: the browser must receive the signed storage URL.
    const response = await fetch(request, {
      redirect: "manual",
      cache: "no-store",
    });
    const redirect = response.status >= 300 && response.status < 400;
    // Express answers Accept: text/html redirects with a tiny HTML body; those are ours.
    if (
      !redirect &&
      (response.headers.get("Content-Type") || "").includes("text/html")
    ) {
      await response.body?.cancel();
      return wakingUp();
    }
    const headers = new Headers(response.headers);
    for (const header of hopHeaders) headers.delete(header);
    headers.set("Cache-Control", "private, no-store");
    const location = headers.get("Location");
    if (
      location &&
      response.status >= 300 &&
      response.status < 400 &&
      previewPath.test(incoming.pathname) &&
      incoming.searchParams.get("stream") === "1"
    ) {
      const target = new URL(location, upstream);
      const sameOrigin = target.origin === upstream.origin;
      if (
        target.protocol === "https:" &&
        (sameOrigin || target.hostname.endsWith(".r2.cloudflarestorage.com"))
      )
        return await streamPdf(target, context.request, sameOrigin);
    }
    if (location) {
      const redirect = new URL(location, upstream);
      if (
        redirect.origin === upstream.origin &&
        (redirect.pathname === "/api" || redirect.pathname.startsWith("/api/"))
      ) {
        headers.set(
          "Location",
          incoming.origin + redirect.pathname + redirect.search + redirect.hash,
        );
      }
    }
    // Copy all response headers, including each separate Set-Cookie. The
    // backend's host-only cookies now belong to the Pages hostname.
    if (redirect) {
      // Drop the redirect body so no HTML ever reaches the page, even ours.
      await response.body?.cancel();
      headers.delete("Content-Type");
      headers.delete("Content-Length");
    }
    return new Response(redirect ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return failure(
      502,
      "PROXY_UPSTREAM_UNAVAILABLE",
      "We could not reach the library. Please try again.",
    );
  }
}
