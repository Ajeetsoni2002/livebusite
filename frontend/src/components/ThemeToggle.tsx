import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
type Theme = "light" | "dark";
const KEY = "buit-theme";
const saved = (): Theme | null => {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
};
const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
};
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== KEY) return;
      const next = event.newValue === "light" ? "light" : "dark";
      apply(next);
      setTheme(next);
    };
    // Until the visitor picks a theme, keep following the operating system.
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const follow = (event: MediaQueryListEvent) => {
      if (saved()) return;
      const next = event.matches ? "light" : "dark";
      apply(next);
      setTheme(next);
    };
    window.addEventListener("storage", sync);
    media?.addEventListener("change", follow);
    return () => {
      window.removeEventListener("storage", sync);
      media?.removeEventListener("change", follow);
    };
  }, []);
  return (
    <button
      className="theme-toggle icon-button"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        apply(next);
        setTheme(next);
        try {
          localStorage.setItem(KEY, next);
        } catch {
          /* Theme remains usable without persistence. */
        }
      }}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
