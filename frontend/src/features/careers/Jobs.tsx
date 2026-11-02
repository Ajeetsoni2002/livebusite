import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  GraduationCap,
  IndianRupee,
  MapPin,
} from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { usePageMeta } from "../../lib/meta";
import { ErrorState, Skeleton } from "../../components/ui";

export type JobPost = {
  _id: string;
  slug: string;
  title: string;
  kind: "job" | "internship";
  company: string;
  location?: string;
  mode: "onsite" | "remote" | "hybrid";
  pay?: string;
  duration?: string;
  eligibility?: string;
  description?: string;
  deadline?: string;
  externalUrl?: string;
  createdAt: string;
  open?: boolean;
};
const modeLabel = { onsite: "On-site", remote: "Remote", hybrid: "Hybrid" };
const date = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function Facts({ post }: { post: JobPost }) {
  return (
    <ul className="job-facts">
      <li>
        <MapPin size={15} aria-hidden />
        {[post.location, modeLabel[post.mode]].filter(Boolean).join(" · ")}
      </li>
      {post.pay && (
        <li>
          <IndianRupee size={15} aria-hidden />
          {post.pay}
        </li>
      )}
      {post.duration && (
        <li>
          <CalendarClock size={15} aria-hidden />
          {post.duration}
        </li>
      )}
      {post.deadline && (
        <li>
          <CalendarClock size={15} aria-hidden />
          Apply by {date(post.deadline)}
        </li>
      )}
    </ul>
  );
}

export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const kind =
    params.get("kind") === "job" || params.get("kind") === "internship"
      ? params.get("kind")
      : "";
  usePageMeta(
    "Jobs & internships for BUIT students",
    "Latest jobs and internships for Barkatullah University (BUIT Bhopal) students. Apply online in a minute.",
  );
  const query = useQuery({
    queryKey: ["jobs", kind],
    queryFn: async () =>
      (await api.get("/jobs", { params: kind ? { kind } : {} })).data
        .data as JobPost[],
    staleTime: 60_000,
  });
  return (
    <main className="page jobs-page">
      <div className="page-heading">
        <div className="eyebrow">BUIT / CAREERS</div>
        <h1>Jobs &amp; internships.</h1>
        <p>
          Openings shared for BUIT and Barkatullah University students. Read the
          details and apply with a short form.
        </p>
      </div>
      <div className="tabs" role="tablist" aria-label="Filter openings">
        {[
          ["", "All"],
          ["internship", "Internships"],
          ["job", "Jobs"],
        ].map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={kind === value}
            className={kind === value ? "active" : ""}
            onClick={() => setParams(value ? { kind: value } : {})}
          >
            {label}
          </button>
        ))}
      </div>
      {query.isPending ? (
        <Skeleton count={3} />
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : !query.data.length ? (
        <div className="empty card">
          <BriefcaseBusiness size={32} />
          <h3>No openings right now</h3>
          <p>New jobs and internships are posted here. Check back soon.</p>
          <Link className="button secondary" to="/papers">
            Browse papers meanwhile <ArrowUpRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="jobs-list">
          {query.data.map((post) => (
            <Link
              key={post._id}
              className="card job-card"
              to={`/jobs/${post.slug}`}
            >
              <span className={`job-kind ${post.kind}`}>
                {post.kind === "job" ? "Job" : "Internship"}
              </span>
              <h2>{post.title}</h2>
              <p className="job-company">{post.company}</p>
              <Facts post={post} />
              <span className="job-cta">
                View &amp; apply <ArrowUpRight size={15} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

/** schema.org JobPosting, so openings can appear in Google's job search. */
function useJobPostingSchema(post?: JobPost) {
  useEffect(() => {
    if (!post) return;
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: post.title,
      description: post.description,
      datePosted: post.createdAt,
      ...(post.deadline ? { validThrough: post.deadline } : {}),
      employmentType: post.kind === "internship" ? "INTERN" : "FULL_TIME",
      hiringOrganization: { "@type": "Organization", name: post.company },
      ...(post.mode === "remote"
        ? {
            jobLocationType: "TELECOMMUTE",
            applicantLocationRequirements: {
              "@type": "Country",
              name: "India",
            },
          }
        : {
            jobLocation: {
              "@type": "Place",
              address: {
                "@type": "PostalAddress",
                addressLocality: post.location || "Bhopal",
                addressRegion: "Madhya Pradesh",
                addressCountry: "IN",
              },
            },
          }),
    });
    document.head.append(script);
    return () => script.remove();
  }, [post]);
}

export function JobDetail() {
  const { slug = "" } = useParams();
  const query = useQuery({
    queryKey: ["job", slug],
    queryFn: async () => (await api.get(`/jobs/${slug}`)).data.data as JobPost,
    retry: false,
  });
  const post = query.data;
  usePageMeta(
    post ? `${post.title} at ${post.company}` : "Opening",
    post
      ? `${post.kind === "job" ? "Job" : "Internship"} at ${post.company}${post.location ? ` in ${post.location}` : ""}. Apply online on BUIT Papers.`
      : undefined,
  );
  useJobPostingSchema(post);
  return (
    <main className="page job-detail">
      <Link to="/jobs" className="back-link">
        <ArrowLeft size={16} /> All jobs &amp; internships
      </Link>
      {query.isPending ? (
        <Skeleton count={1} />
      ) : query.isError || !post ? (
        <div className="empty card">
          <BriefcaseBusiness size={32} />
          <h3>This opening is no longer listed</h3>
          <Link className="button secondary" to="/jobs">
            See current openings <ArrowUpRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="job-layout">
          <article className="card job-body">
            <span className={`job-kind ${post.kind}`}>
              {post.kind === "job" ? "Job" : "Internship"}
            </span>
            <h1>{post.title}</h1>
            <p className="job-company">{post.company}</p>
            <Facts post={post} />
            {post.eligibility && (
              <p className="job-eligibility">
                <GraduationCap size={16} aria-hidden /> {post.eligibility}
              </p>
            )}
            <div className="job-description">{post.description}</div>
          </article>
          <aside>
            {!post.open ? (
              <div className="card notice">Applications have closed.</div>
            ) : post.externalUrl ? (
              <div className="card job-apply">
                <h2>Apply</h2>
                <p>This company takes applications on its own site.</p>
                <a
                  className="button"
                  href={post.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  Apply on company site <ArrowUpRight size={16} />
                </a>
              </div>
            ) : (
              <ApplyForm slug={post.slug} />
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function ApplyForm({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle"),
    [error, setError] = useState("");
  if (state === "sent")
    return (
      <div className="card job-apply become-done" role="status">
        <CheckCircle2 size={34} aria-hidden />
        <h2>Application sent.</h2>
        <p>
          Your details have been shared. If you are shortlisted, you will hear
          back on your email or phone.
        </p>
        <Link className="button secondary" to="/jobs">
          More openings <ArrowUpRight size={16} />
        </Link>
      </div>
    );
  return (
    <form
      className="card job-apply"
      onSubmit={async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const text = (name: string) => String(values.get(name) || "").trim();
        const number = (name: string) =>
          text(name) ? Number(text(name)) : undefined;
        setError("");
        setState("sending");
        try {
          await api.post(`/jobs/${slug}/apply`, {
            name: text("name"),
            email: text("email"),
            phone: text("phone"),
            branch: text("branch") || undefined,
            semester: number("semester"),
            graduationYear: number("graduationYear"),
            college: text("college") || undefined,
            resumeUrl: text("resumeUrl"),
            note: text("note") || undefined,
            website: text("website") || undefined,
          });
          setState("sent");
        } catch (e) {
          setError(errorMessage(e));
          setState("idle");
        }
      }}
    >
      <h2>Apply now</h2>
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
        Phone / WhatsApp
        <input
          name="phone"
          type="tel"
          required
          maxLength={18}
          pattern="\+?[0-9 \-]{7,18}"
          autoComplete="tel"
          placeholder="+91 98765 43210"
        />
      </label>
      <div className="become-row">
        <label>
          Branch
          <input name="branch" maxLength={80} placeholder="CSE" />
        </label>
        <label>
          Semester
          <select name="semester" defaultValue="">
            <option value="">—</option>
            {Array.from({ length: 8 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="become-row">
        <label>
          Passing year
          <input
            name="graduationYear"
            type="number"
            min={2000}
            max={2100}
            placeholder={String(new Date().getFullYear() + 1)}
          />
        </label>
        <label>
          College
          <input name="college" maxLength={160} defaultValue="BUIT, Bhopal" />
        </label>
      </div>
      <label>
        Résumé link (Google Drive, OneDrive…)
        <input
          name="resumeUrl"
          type="url"
          required
          maxLength={500}
          placeholder="https://drive.google.com/…"
        />
        <small className="muted">
          Set the file to “Anyone with the link can view”.
        </small>
      </label>
      <label>
        Why are you a good fit? (optional)
        <textarea name="note" maxLength={1500} rows={4} />
      </label>
      <label className="become-trap" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Submit application"}
        <ArrowUpRight size={17} />
      </button>
    </form>
  );
}
