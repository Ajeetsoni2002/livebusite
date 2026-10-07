import { apiUrl } from "./api";

let last = 0;
/**
 * The free Render API sleeps after inactivity. A cheap ping on app load and when a
 * visitor approaches a paper usually wakes it before they click. At most once a minute.
 */
export function wake(force = false) {
  const now = Date.now();
  if (!force && now - last < 60_000) return;
  last = now;
  fetch(apiUrl("/ping"), {
    cache: "no-store",
    credentials: "omit",
    keepalive: true,
  }).catch(() => {});
}

/**
 * Waits until the API answers before a large upload, so the file is not sent into a
 * sleeping free instance (the request would die while it boots). About 90 s at most.
 */
export async function ensureAwake(onWaiting?: () => void) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(apiUrl("/ping"), {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (
        response.ok &&
        (response.headers.get("Content-Type") || "").includes("json")
      )
        return;
    } catch {
      /* still waking */
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) onWaiting?.();
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(
    "The server is not responding. Please try again in a minute.",
  );
}
