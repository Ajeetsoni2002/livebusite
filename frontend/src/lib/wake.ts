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
