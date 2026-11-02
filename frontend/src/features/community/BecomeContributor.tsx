import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  FileUp,
  KeyRound,
  IndianRupee,
  UserPlus,
} from "lucide-react";
import { EarnCheque } from "../../components/Earn";
import { RATE, rupees } from "../../lib/earn";
import { api, errorMessage } from "../../lib/api";
import { usePageMeta } from "../../lib/meta";
import { usePublic } from "../../lib/queries";
import type { Entity } from "../../lib/types";

const steps = [
  [UserPlus, "Create your account", "Takes a minute. No waiting for approval."],
  [
    FileUp,
    "Upload papers",
    "Upload PDFs or photos from your contributor workspace.",
  ],
  [
    KeyRound,
    "Admin approves",
    "Each upload is checked by an admin before it goes live.",
  ],
  [
    IndianRupee,
    `Earn ${rupees(RATE)} each`,
    "Every approved paper or note adds money to your earnings, and your name goes on the board.",
  ],
] as const;
const faq = [
  [
    "What counts as approved?",
    "An admin checks each upload. Once it is published on the site, it counts. Duplicates of papers we already have, and unreadable scans, are not approved.",
  ],
  [
    "Do notes count as much as papers?",
    `Yes. Every approved paper and every approved note earns ${rupees(RATE)}.`,
  ],
  [
    "Where do I see my earnings?",
    "Sign in to your contributor workspace and open Earnings. It shows approved uploads, what you have earned, what has been paid and what is still due.",
  ],
  [
    "Is there a limit?",
    "No. Upload as many genuine papers and notes as you have.",
  ],
] as const;

export default function BecomeContributor() {
  usePageMeta(
    "Become a contributor",
    `Have Barkatullah University question papers or notes? Become a contributor and earn ${rupees(RATE)} for every approved upload.`,
  );
  const branches = usePublic<Entity[]>("/branches");
  const navigate = useNavigate(),
    client = useQueryClient();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  return (
    <main className="page info-page become-page">
      <div className="page-heading">
        <div className="eyebrow">BUIT / CONTRIBUTE &amp; EARN</div>
        <h1>
          Your old papers are worth{" "}
          <mark className="eh-mark">{rupees(RATE)} each.</mark>
        </h1>
        <p>
          Upload previous year question papers and your notes. Every approved
          paper earns you {rupees(RATE)}, and every approved note earns{" "}
          {rupees(RATE)} too. Create your contributor account and start
          uploading right away.
        </p>
        <div className="row-actions">
          <a className="button" href="#join">
            Create contributor account <ArrowUpRight size={17} />
          </a>
          <Link className="button secondary" to="/contributor/login">
            Contributor login
          </Link>
        </div>
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
      <EarnCheque heading={false} />
      <div className="contact-grid" id="join">
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
            We use your email for sign-in and password resets only. Already have
            an account? <Link to="/contributor/login">Sign in</Link>. Forgot
            your password? <Link to="/forgot-password">Reset it</Link>.
          </p>
        </div>
        <form
          className="card"
          onSubmit={async (event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const text = (name: string) =>
              String(values.get(name) || "").trim();
            setError("");
            if (text("password") !== text("confirm"))
              return setError("The two passwords do not match.");
            setSending(true);
            try {
              const result = await api.post("/auth/register", {
                name: text("name"),
                email: text("email"),
                password: String(values.get("password") || ""),
                phone: text("phone"),
                branch: text("branch") || undefined,
                semester: text("semester")
                  ? Number(text("semester"))
                  : undefined,
                consent: values.get("consent") === "on",
                website: text("website") || undefined,
              });
              client.setQueryData(["me"], result.data.data);
              navigate("/contributor/upload");
            } catch (e) {
              setError(errorMessage(e));
              setSending(false);
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
            Password · at least 12 characters
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
            />
          </label>
          <label>
            Type the password again
            <input
              name="confirm"
              type="password"
              required
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
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
          <button className="button" disabled={sending}>
            {sending ? "Creating account…" : "Create contributor account"}
            <ArrowUpRight size={17} />
          </button>
        </form>
      </div>
      <section className="eh-faq" aria-labelledby="earn-faq">
        <h2 id="earn-faq">Questions about earning</h2>
        {faq.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
