// Serves public files straight from R2 so previews and covers work while the API sleeps.
// Needs an R2 bucket binding named FILES on the Pages project; without it every request
// gets a 404 and the app falls back to the API routes.
type R2Range = { offset?: number; length?: number; suffix?: number };
type R2Object = {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  range?: R2Range;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
};
type R2Bucket = {
  get(key: string, options?: { range?: Headers }): Promise<R2Object | null>;
};

// Watermarked PDFs must be marked public at upload; cover thumbnails are always safe to show.
const allowed =
  /^(watermarked\/[0-9a-f-]{36}\.pdf|thumbnails\/[0-9a-f-]{36}\.webp)$/;

function notFound() {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "File not found." } },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function onRequest(context: {
  request: Request;
  env: { FILES?: R2Bucket };
}): Promise<Response> {
  const { request, env } = context;
  if (!env.FILES || !["GET", "HEAD"].includes(request.method))
    return notFound();
  const key = decodeURIComponent(
    new URL(request.url).pathname.replace(/^\/files\//, ""),
  );
  if (!allowed.test(key)) return notFound();
  let object: R2Object | null;
  try {
    object = await env.FILES.get(key, { range: request.headers });
  } catch {
    return notFound();
  }
  if (!object) return notFound();
  const pdf = key.endsWith(".pdf");
  if (pdf && object.customMetadata?.visibility !== "public") {
    await object.body?.cancel();
    return notFound();
  }
  const headers = new Headers({
    "Content-Type": pdf ? "application/pdf" : "image/webp",
    // Keys are random and never reused, so the CDN may keep them forever.
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: object.httpEtag,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    ...(pdf ? { "Content-Disposition": "inline" } : {}),
  });
  let status = 200;
  const range = object.range;
  if (range && request.headers.has("Range")) {
    const start =
      range.suffix !== undefined
        ? object.size - range.suffix
        : (range.offset ?? 0);
    const length =
      range.suffix !== undefined
        ? range.suffix
        : (range.length ?? object.size - start);
    headers.set(
      "Content-Range",
      `bytes ${start}-${start + length - 1}/${object.size}`,
    );
    headers.set("Content-Length", String(length));
    status = 206;
  } else headers.set("Content-Length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, {
    status,
    headers,
  });
}
