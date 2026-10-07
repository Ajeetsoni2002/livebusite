import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  CheckCircle2,
  FileUp,
  KeyRound,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { usePageMeta } from "../../lib/meta";
import { usePublic } from "../../lib/queries";
import type { Entity } from "../../lib/types";

const steps = [
  [UserPlus, "Send a request", "Tell us who you are and what you can share."],
  [
    KeyRound,
    "Get your login",
    "An admin reviews it and sends your sign-in details.",
  ],
  [
    FileUp,
    "Upload papers",
    "Upload PDFs; each one is checked before it goes live.",
  ],
  [
    ShieldCheck,
    "Get credited",
    "Show your name and photo on the board, or stay anonymous.",
  ],
] as const;

export default function BecomeContributor() {
  usePageMeta(
    "Become a contributor",
    "Have Barkatullah University question papers or notes? Request a contributor account and share them with the next batch.",
  );
  const branches = usePublic<Entity[]>("/branches");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  return (
    <main className="page info-page become-page">
      <div className="page-heading">
        <div className="eyebrow">BUIT / CONTRIBUTE</div>
        <h1>
          Have papers? <span className="gradient-text">Share them.</span>
        </h1>
        <p>
          Contributors upload question papers and notes for everyone. Ask for an
          account and we will set you up.
        </p>
      </div>
      <ol className="become-steps">
        {steps.map(([Icon, title, text], i) => (
          <li key={title} className="card">
            <span className="become-step-no">
              {String(i + 1).padStart(2, "0")}
            </span>
            <Icon size={22} aria-hidden />
            <strong>{title}</strong>
            <span className="muted">{text}</span>
          </li>
        ))}
      </ol>
      <div className="contact-grid">
        <div className="become-copy">
          <h2>What we look for</h2>
          <ul>
            <li>Previous year papers of any BUIT branch or semester.</li>
            <li>
              Clear photos or scans — our upload tool cleans and splits pages
              for you.
            </li>
            <li>Your own notes, or material you are allowed to share.</li>
          </ul>
          <p className="muted">
            We use your email or phone only to send your login details. Already
            have an account? <Link to="/contributor/login">Sign in</Link>.
          </p>
        </div>
        {state === "sent" ? (
          <div className="card become-done" role="status">
            <CheckCircle2 size={34} aria-hidden />
            <h2>Request received.</h2>
            <p>
              Thank you! An admin will review it and send your sign-in details
              to the email or phone you gave. This usually takes a day or two.
            </p>
            <Link className="button secondary" to="/papers">
              Browse papers meanwhile <ArrowUpRight size={16} />
            </Link>
          </div>
        ) : (
          <form
            className="card"
            onSubmit={async (event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              const text = (name: string) =>
                String(values.get(name) || "").trim();
              setError("");
              setState("sending");
              try {
                await api.post("/contributor-requests", {
                  name: text("name"),
                  email: text("email"),
                  phone: text("phone"),
                  branch: text("branch") || undefined,
                  semester: text("semester")
                    ? Number(text("semester"))
                    : undefined,
                  institution: text("institution") || undefined,
                  message: text("message"),
                  consent: values.get("consent") === "on",
                  website: text("website") || undefined,
                });
                setState("sent");
              } catch (e) {
                setError(errorMessage(e));
                setState("idle");
              }
            }}
          >
            <label>
              Full name
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
              />
            </label>
            <label>
              Phone / WhatsApp (optional)
              <input
                name="phone"
                type="tel"
                maxLength={18}
                pattern="\+?[0-9 \-]{7,18}"
                autoComplete="tel"
                placeholder="+91 98765 43210"
              />
            </label>
            <div className="become-row">
              <label>
                Branch
                <select name="branch" defaultValue="">
                  <option value="">Choose…</option>
                  {branches.data?.data.map((b) => (
                    <option key={b._id} value={b.code || b.name}>
                      {b.code ? `${b.code} · ${b.name}` : b.name}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </select>
              </label>
              <label>
                Semester
                <select name="semester" defaultValue="">
                  <option value="">Choose…</option>
                  {Array.from({ length: 8 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      Semester {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              College / enrollment number (optional)
              <input name="institution" maxLength={160} />
            </label>
            <label>
              What can you share?
              <textarea
                name="message"
                required
                minLength={20}
                maxLength={1500}
                rows={4}
                placeholder="E.g. CSE semester 3 end-sem papers for 2023 and 2024, and my DBMS notes."
              />
            </label>
            {/* Hidden from people; bots that fill it are ignored. */}
            <label className="become-trap" aria-hidden="true">
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
            <label className="inline-check">
              <input type="checkbox" name="consent" required />
              <span>I own these files or am allowed to share them.</span>
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="button" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Request contributor access"}
              <ArrowUpRight size={17} />
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
