import { useEffect, useState } from "react";

const read = () => {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string) => style.getPropertyValue(name).trim();
  return {
    primary: get("--primary"),
    accent: get("--accent"),
    success: get("--success"),
    warning: get("--warning"),
    text: get("--text"),
    muted: get("--muted"),
    border: get("--border"),
    surface: get("--surface"),
    raised: get("--raised"),
  };
};

/** Resolved theme tokens for libraries (charts, canvas) that cannot read CSS variables. */
export function useThemeColors() {
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const watch = new MutationObserver(() => setColors(read()));
    watch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => watch.disconnect();
  }, []);
  return colors;
}
