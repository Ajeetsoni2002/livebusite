import { useEffect, useState, createContext, useContext } from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
import { usePageMeta } from "../../lib/meta";
import { rememberWorkspace } from "../../lib/session";
import { ShieldCheck, ArrowRight } from "lucide-react";
type User = {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "contributor";
  mustChangePassword: boolean;
};
const UserContext = createContext<User | null>(null);
export function useUser() {
  const user = useContext(UserContext);
  if (!user) throw new Error("Authenticated workspace required");
  return user;
}
export function Guard({ role }: { role: "admin" | "contributor" }) {
  const query = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get("/auth/me")).data.data as User,
    retry: false,
    staleTime: 0,
  });
  const signedIn = query.data?.role;
  // Public pages read this to offer a way back into the workspace.
  useEffect(() => {
    if (signedIn) rememberWorkspace(signedIn);
  }, [signedIn]);
  if (query.isPending)
    return (
      <main className="page" role="status">
        Checking your session…
      </main>
    );
  if (!query.data) return <Navigate to={`/${role}/login`} replace />;
  if (query.data.mustChangePassword) return <ChangePassword />;
  if (query.data.role !== role)
    return <Navigate to={`/${query.data.role}`} replace />;
  return (
    <UserContext.Provider value={query.data}>
      <Outlet />
    </UserContext.Provider>
  );
}
export function Login() {
  const location = useLocation(),
    contributor = location.pathname.startsWith("/contributor"),
    justReset = Boolean((location.state as { reset?: boolean } | null)?.reset);
  usePageMeta(
    contributor ? "Contributor login" : "Admin login",
    "Sign in to upload Barkatullah University question papers and notes.",
    { noindex: !contributor },
  );
  const navigate = useNavigate(),
    client = useQueryClient(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-card card">
        <ShieldCheck size={32} className="accent" />
        <h1>{contributor ? "Contributor login" : "Library workspace"}</h1>
        <p>
          {contributor
            ? "Sign in to upload papers and notes and see your earnings."
            : "Sign in with your admin account."}
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            const input = new FormData(event.currentTarget);
            try {
              const result = await api.post("/auth/login", {
                email: String(input.get("email")),
                password: String(input.get("password")),
              });
              client.setQueryData(["me"], result.data.data);
              navigate(`/${result.data.data.role}`, { replace: true });
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input type="email" name="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              maxLength={72}
            />
          </label>
          {justReset && !error && (
            <p className="notice" role="status">
              Password changed. Sign in with your new password.
            </p>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy} className="button">
            {busy ? "Signing in…" : "Sign in"}
            <ArrowRight size={16} />
          </button>
        </form>
        <p className="login-help">
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
        {contributor && (
          <p className="login-help">
            No account yet?{" "}
            <Link to="/contribute#join">Create a contributor account</Link>
          </p>
        )}
      </div>
    </main>
  );
}
function ChangePassword() {
  const client = useQueryClient(),
    [message, setMessage] = useState("");
  return (
    <main className="login-page">
      <div className="login-card card">
        <h1>Make this account yours.</h1>
        <p>Change the temporary password before opening your workspace.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            try {
              await api.post("/auth/change-password", {
                currentPassword: String(form.get("current")),
                newPassword: String(form.get("new")),
              });
              await client.invalidateQueries({ queryKey: ["me"] });
            } catch (e) {
              setMessage(errorMessage(e));
            }
          }}
        >
          <label>
            Current temporary password
            <input
              type="password"
              name="current"
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            New password · at least 12 characters
            <input
              type="password"
              name="new"
              required
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
            />
          </label>
          <button className="button">Save password</button>
          {message && <p role="alert">{message}</p>}
        </form>
      </div>
    </main>
  );
}
