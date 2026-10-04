import { useEffect } from "react";
export function usePageMeta(
  title: string,
  description = "Find Barkatullah University question papers and short notes, organized by branch, semester and subject.",
) {
  useEffect(() => {
    document.title = `${title} · BUIT Papers`;
    const url = `${import.meta.env.VITE_SITE_URL || location.origin}${location.pathname}`;
    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = url;
    for (const [key, value] of [
      ["description", description],
      ["og:title", document.title],
      ["og:description", description],
      [
        "og:url",
        `${import.meta.env.VITE_SITE_URL || location.origin}${location.pathname}`,
      ],
    ]) {
      let element = document.head.querySelector<HTMLMetaElement>(
        `meta[${key.startsWith("og:") ? "property" : "name"}="${key}"]`,
      );
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(key.startsWith("og:") ? "property" : "name", key);
        document.head.append(element);
      }
      element.content = value;
    }
  }, [title, description]);
}
