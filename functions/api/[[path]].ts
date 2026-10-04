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
    const headers = new Headers(response.headers);
    for (const header of hopHeaders) headers.delete(header);
    headers.set("Cache-Control", "private, no-store");
    const location = headers.get("Location");
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
    return new Response(response.body, {
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
