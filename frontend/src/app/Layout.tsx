import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Command, Menu, X } from "lucide-react";
import Footer from "../components/Footer";
import ThemeToggle from "../components/ThemeToggle";
const CommandPalette = lazy(() => import("../components/CommandPalette"));
const AmbientEffects = lazy(() => import("../components/AmbientEffects"));
export default function Layout() {
  const { pathname, key: locationKey } = useLocation();
  const initialLocation = useRef(locationKey);
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘ K"
    : "Ctrl K";
  const [palette, setPalette] = useState(false),
    [menu, setMenu] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [effects, setEffects] = useState(false);
  useEffect(() => {
    const saveData = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection?.saveData;
    if (
      saveData ||
      navigator.hardwareConcurrency <= 2 ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = setTimeout(() => setEffects(true), 1600);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    if (!palette) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button, input, a[href], [tabindex="0"]',
        ) || []),
      ].filter(
        (control) =>
          control.tabIndex >= 0 &&
          !control.matches(":disabled") &&
          control.getClientRects().length > 0,
      );
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus();
    };
  }, [palette]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!palette)
          returnFocus.current = document.activeElement as HTMLElement;
        setPalette((value) => !value);
      }
      if (event.key === "Escape") {
        setPalette(false);
        setMenu(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [palette]);
  return (
    <>
      <div inert={palette}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="navbar">
          <div className="nav-inner">
            <Link className="brand" to="/">
              <img src="/branding/crest.webp" alt="" width="42" height="42" />
              <span>
                <strong>
                  BUIT<span className="accent">PAPERS</span>
                </strong>
                <small>BARKATULLAH UNIVERSITY</small>
              </span>
            </Link>
            <nav
              id="main-navigation"
              className={menu ? "open" : ""}
              aria-label="Main navigation"
            >
              <NavLink to="/papers" onClick={() => setMenu(false)}>
                Question papers
              </NavLink>
              <NavLink to="/notes" onClick={() => setMenu(false)}>
                Short notes
              </NavLink>
              <NavLink to="/about" onClick={() => setMenu(false)}>
                Our community
              </NavLink>
            </nav>
            <button
              className="palette-trigger"
              onClick={(event) => {
                returnFocus.current = event.currentTarget;
                setMenu(false);
                setPalette(true);
              }}
              aria-label="Open search"
            >
              <Command size={15} />
              <span>Search</span>
              <kbd>{shortcut}</kbd>
            </button>
            <ThemeToggle />
            <button
              className="mobile-toggle icon-button"
              onClick={() => setMenu((v) => !v)}
              aria-expanded={menu}
              aria-controls="main-navigation"
              aria-label="Toggle navigation"
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </header>
        <div id="main" className={`route-content ${locationKey === initialLocation.current ? "" : "route-enter"}`} key={pathname} tabIndex={-1}>
          <Outlet />
        </div>
        <Footer />
      </div>
      {effects && (
        <Suspense fallback={null}>
          <AmbientEffects route={pathname} />
        </Suspense>
      )}
      {palette && (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <p className="card staff-card" role="status">
                Opening search…
              </p>
            </div>
          }
        >
          <CommandPalette dialog={dialog} onClose={() => setPalette(false)} />
        </Suspense>
      )}
    </>
  );
}
