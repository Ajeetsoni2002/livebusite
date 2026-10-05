import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FolderTree,
  Inbox,
  LayoutDashboard,
  LogOut,
  NotebookPen,
  ScrollText,
  Search,
  ShieldCheck,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useUser } from "./Auth";
import { api } from "../../lib/api";

const COLLAPSE_KEY = "buit-staff-collapsed";
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
};

export default function Workspace() {
  const user = useUser(),
    navigate = useNavigate(),
    client = useQueryClient(),
    [collapsed, setCollapsed] = useState(readCollapsed),
    [profile, setProfile] = useState(false),
    menu = useRef<HTMLDivElement>(null);
  const entries: [string, string, LucideIcon][] =
    user.role === "admin"
      ? [
          ["", "Dashboard", LayoutDashboard],
          ["papers", "Papers", FileText],
          ["notes", "Notes", NotebookPen],
          ["upload", "Upload / bulk", Upload],
          ["moderation", "Moderation", ShieldCheck],
          ["taxonomy", "Branches & subjects", FolderTree],
          ["contributors", "Contributors", Users],
          ["inbox", "Reports & requests", Inbox],
          ["audit", "Audit log", ScrollText],
          ["analytics", "Analytics", BarChart3],
        ]
      : [
          ["", "My papers", FileText],
          ["notes", "My notes", NotebookPen],
          ["upload", "Upload papers / notes", Upload],
        ];
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* Collapse state is a convenience only. */
    }
  }, [collapsed]);
  useEffect(() => {
    if (!profile) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !menu.current?.contains(event.target as Node)
      )
        setProfile(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [profile]);
  async function signOut() {
    await api.post("/auth/logout");
    client.clear();
    navigate(`/${user.role}/login`);
  }
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <main className={`staff-page ${collapsed ? "nav-collapsed" : ""}`}>
      <div className="staff-topbar glass">
        <div>
          <div className="eyebrow">{user.role.toUpperCase()} WORKSPACE</div>
          <h1>Hello, {user.name.split(" ")[0]}.</h1>
        </div>
        <form
          className="staff-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const q = String(new FormData(event.currentTarget).get("q") || "");
            const base = user.role === "admin" ? "papers" : "";
            navigate(
              `/${user.role}${base ? `/${base}` : ""}${q ? `?q=${encodeURIComponent(q)}` : ""}`,
            );
          }}
        >
          <Search size={16} aria-hidden />
          <input
            name="q"
            aria-label="Search uploads"
            placeholder="Search uploads…"
            maxLength={120}
          />
        </form>
        <div className="staff-tools">
          <div className="profile-menu" ref={menu}>
            <button
              className="avatar-button"
              aria-haspopup="menu"
              aria-expanded={profile}
              aria-label={`Account menu for ${user.name}`}
              onClick={() => setProfile((open) => !open)}
            >
              <span className="avatar" aria-hidden>
                {initials}
              </span>
            </button>
            {profile && (
              <div className="profile-popover card" role="menu">
                <strong>{user.name}</strong>
                <span className="muted">
                  {user.role === "admin" ? "Administrator" : "Contributor"}
                </span>
                <button role="menuitem" onClick={signOut}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="staff-layout">
        <nav className="staff-nav card" aria-label="Workspace navigation">
          {entries.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              end={path === ""}
              to={`/${user.role}${path ? `/${path}` : ""}`}
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
            >
              <Icon size={18} aria-hidden />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
          <button
            className="collapse-toggle"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight size={18} />
            ) : (
              <ChevronsLeft size={18} />
            )}
            <span className="nav-label">Collapse</span>
          </button>
          <button onClick={signOut} title={collapsed ? "Sign out" : undefined}>
            <LogOut size={18} aria-hidden />
            <span className="nav-label">Sign out</span>
          </button>
        </nav>
        <div className="staff-content">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
