import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { apiUrl } from "./api";
type Event = {
  eventId: string;
  kind: "pageview" | "contentview" | "search";
  path?: string;
  contentId?: string;
  contentType?: string;
  query?: string;
  referrer?: string;
};
const queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
function flush() {
  if (!queue.length) return;
  const events = queue.splice(0, 20);
  void fetch(apiUrl("/analytics/events"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify({ events }),
  }).catch(() => {});
}
export function track(event: Omit<Event, "eventId">) {
  if (
    navigator.doNotTrack === "1" ||
    /^\/(?:admin|contributor)/.test(location.pathname)
  )
    return;
  queue.push({ ...event, eventId: crypto.randomUUID() });
  clearTimeout(timer);
  timer = setTimeout(flush, 750);
}
export function PageAnalytics() {
  const location = useLocation(),
    previous = useRef("");
  useEffect(() => {
    if (previous.current === location.pathname) return;
    previous.current = location.pathname;
    track({
      kind: "pageview",
      path: location.pathname,
      referrer: document.referrer,
    });
  }, [location.pathname]);
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  return null;
}
