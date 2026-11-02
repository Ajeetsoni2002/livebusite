import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, KeyRound, MailCheck } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { usePageMeta } from "../../lib/meta";

export function ForgotPassword() {
  usePageMeta("Forgot password", undefined, { noindex: true });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle"),
    [error, setError] = useState("");
  if (state === "sent")
    return (
      <main className="login-page">
        <div className="login-card card" role="status">
          <MailCheck size={32} className="accent" />
          <h1>Check your email.</h1>
          <p>
            If an account uses that address, we have sent it a link to choose a
            new password. The link works for 30 minutes. Look in spam too.
          </p>
          <Link className="button secondary" to="/contributor/login">
            Back to sign in
          </Link>
        </div>
      </main>
    );
  return (
    <main className="login-page">
      <div className="login-card card">
        <KeyRound size={32} className="accent" />
        <h1>Forgot your password?</h1>
        <p>Enter your account email and we will send you a reset link.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const email = String(
              new FormData(event.currentTarget).get("email"),
            ).trim();
            setState("sending");
            setError("");
            try {
              await api.post("/auth/forgot-password", { email });
              setState("sent");
            } catch (e) {
              setError(errorMessage(e));
              setState("idle");
            }
          }}
        >
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button className="button" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Send reset link"}
            <ArrowRight size={16} />
          </button>
        </form>
        <p className="login-help">
          Remembered it? <Link to="/contributor/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}

export function ResetPassword() {
  usePageMeta("Choose a new password", undefined, { noindex: true });
  const [params] = useSearchParams(),
    navigate = useNavigate(),
    token = params.get("token") || "",
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-card card">
        <KeyRound size={32} className="accent" />
        <h1>Choose a new password.</h1>
        {!token ? (
          <p className="notice error" role="alert">
            This link is incomplete.{" "}
            <Link to="/forgot-password">Ask for a new one</Link>.
          </p>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const password = String(form.get("password"));
              if (password !== String(form.get("confirm")))
                return setError("The two passwords do not match.");
              setBusy(true);
              setError("");
              try {
                const result = await api.post("/auth/reset-password", {
                  token,
                  password,
                });
                navigate(`/${result.data.data.role}/login`, {
                  replace: true,
                  state: { reset: true },
                });
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              New password · at least 6 characters
              <input
                type="password"
                name="password"
                required
                minLength={6}
                maxLength={72}
                autoComplete="new-password"
              />
            </label>
            <label>
              Type it again
              <input
                type="password"
                name="confirm"
                required
                minLength={6}
                maxLength={72}
                autoComplete="new-password"
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}{" "}
                {/expired|invalid/i.test(error) && (
                  <Link to="/forgot-password">Ask for a new link</Link>
                )}
              </p>
            )}
            <button className="button" disabled={busy}>
              {busy ? "Saving…" : "Save new password"}
              <ArrowRight size={16} />
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
