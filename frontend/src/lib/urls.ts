export function resolveApiUrl(path: string, base = "/api") {
  if (/^https?:\/\//i.test(path)) return path;
  return /^https?:/.test(base)
    ? new URL(
        path.startsWith("/api/") ? path : `/api${path}`,
        new URL(base).origin,
      ).href
    : path.startsWith("/api/")
      ? path
      : `${base}${path}`;
}
