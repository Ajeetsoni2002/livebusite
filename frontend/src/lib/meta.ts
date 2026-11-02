import { useEffect } from "react";
export const SITE_NAME = "BUIT Papers";
/**
 * Sets the tab title, description, canonical URL and social tags for a page.
 * Keep the wording in step with scripts/prerender.mjs: Google reads both.
 */
export function usePageMeta(
  title: string,
  description = "Barkatullah University (BU Bhopal) BUIT previous year question papers and short notes for B.Tech, organized by branch, semester and subject. Free PDF download.",
  { noindex = false }: { noindex?: boolean } = {},
) {
  useEffect(() => {
    document.title = title.includes(SITE_NAME)
      ? title
      : `${title} · ${SITE_NAME}`;
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
      [
        "robots",
        noindex ? "noindex, follow" : "index, follow, max-image-preview:large",
      ],
      ["og:title", document.title],
      ["og:description", description],
      ["og:url", url],
      ["twitter:title", document.title],
      ["twitter:description", description],
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
  }, [title, description, noindex]);
}
