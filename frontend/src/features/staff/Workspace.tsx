import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "./Auth";
import { api } from "../../lib/api";
export default function Workspace() {
  const user = useUser(),
    navigate = useNavigate(),
    client = useQueryClient();
  const entries =
    user.role === "admin"
      ? [
          ["", "Dashboard"],
          ["papers", "Papers"],
          ["notes", "Notes"],
          ["upload", "Upload / bulk"],
          ["moderation", "Moderation"],
          ["taxonomy", "Taxonomy"],
          ["contributors", "Contributors"],
          ["inbox", "Reports & requests"],
          ["audit", "Audit log"],
          ["analytics", "Analytics"],
        ]
      : [
          ["", "My papers"],
          ["notes", "My notes"],
          ["upload", "Upload papers / notes"],
        ];
  return (
    <main className="staff-page">
      <div className="staff-title">
        <div>
          <div className="eyebrow">{user.role.toUpperCase()} WORKSPACE</div>
          <h1>Hello, {user.name.split(" ")[0]}.</h1>
        </div>
        <span className="badge">BUIT Library</span>
      </div>
      <div className="staff-layout">
        <nav className="staff-nav card" aria-label="Workspace navigation">
          {entries.map(([path, label]) => (
            <NavLink
              key={path}
              end={path === ""}
              to={`/${user.role}${path ? `/${path}` : ""}`}
            >
              {label}
            </NavLink>
          ))}
          <button
            onClick={async () => {
              await api.post("/auth/logout");
              client.clear();
              navigate(`/${user.role}/login`);
            }}
          >
            Sign out
          </button>
        </nav>
        <div className="staff-content">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
