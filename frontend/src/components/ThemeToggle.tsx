import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
type Theme = "light" | "dark";
const KEY = "buit-theme";
// Light is the default; only an explicit choice of dark is remembered.
const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#17211c" : "#f3eee2");
};
const current = (): Theme =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(current);
  useEffect(() => {
    apply(current());
    const sync = (event: StorageEvent) => {
      if (event.key !== KEY) return;
      const next = event.newValue === "dark" ? "dark" : "light";
      apply(next);
      setTheme(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
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
