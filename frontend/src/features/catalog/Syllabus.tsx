import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, BookOpenCheck, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { api, errorMessage } from "../../lib/api";
import { usePageMeta } from "../../lib/meta";
import {
  subjectPagePath,
  useSyllabusList,
  type SyllabusEntry,
} from "../../lib/syllabus";
import { ErrorState, Skeleton } from "../../components/ui";

/* Keep titles and descriptions in step with scripts/prerender.mjs. */
const UNIVERSITY = "Barkatullah University";
/** Unit titles from "## Unit I – Calculus" headings, for descriptions. */
export const unitTitles = (markdown = "") =>
  [...markdown.matchAll(/^##\s+Unit\s+[IVX\d]+\s*[–:-]\s*(.+)$/gim)].map((m) =>
    m[1].trim(),
  );
const semestersOf = (entry: SyllabusEntry) =>
  [...new Set(entry.offerings.map((o) => o.semester.number))].sort(
    (a, b) => a - b,
  );
const branchesOf = (entry: SyllabusEntry) =>
  [
    ...new Map(
      entry.offerings.map((o) => [o.branch._id, o.branch] as const),
    ).values(),
  ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
/** "CSE · Semester 3", or "All branches · Semester 1" for common first-year subjects. */
function placement(entry: SyllabusEntry) {
  const branches = branchesOf(entry),
    sems = semestersOf(entry);
  return [
    branches.length > 2
      ? "All branches"
      : branches.map((b) => b.code || b.name).join(", "),
    sems.length ? `Semester ${sems.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
const creditsText = (c: SyllabusEntry["credits"]) =>
  c
    ? `L-T-P ${c.L ?? 0}-${c.T ?? 0}-${c.P ?? 0}${c.total != null ? ` · ${c.total} credits` : ""}`
    : "";

export default function SyllabusIndex() {
  usePageMeta(
    `${UNIVERSITY} B.Tech syllabus – BU Bhopal (BUIT) subject-wise`,
    `Subject-wise syllabus of ${UNIVERSITY} (BU Bhopal) BUIT B.Tech: unit-wise topics, course objectives and reference books, with previous year question papers for each subject.`,
  );
  const [params, setParams] = useSearchParams();
  const list = useSyllabusList();
  const branches = useMemo(
    () =>
      [
        ...new Map(
          (list.data || [])
            .flatMap((s) => s.offerings)
            .map((o) => [o.branch.code || o.branch.slug, o.branch] as const),
        ).values(),
      ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [list.data],
  );
  const branch = params.get("branch") || "";
  const shown = (list.data || []).filter(
    (s) =>
      !branch ||
      s.offerings.some((o) => (o.branch.code || o.branch.slug) === branch),
  );
  const bySemester = new Map<number, SyllabusEntry[]>();
  for (const entry of shown) {
    const sem = semestersOf(entry)[0] ?? 0;
    bySemester.set(sem, [...(bySemester.get(sem) || []), entry]);
  }
  return (
    <main className="page syllabus-page">
      <div className="page-heading">
        <div className="eyebrow">BUIT / SYLLABUS</div>
        <h1>B.Tech syllabus, subject by subject.</h1>
        <p>
          The {UNIVERSITY} (BU Bhopal) BUIT syllabus for each subject: units,
          objectives and books, next to that subject’s previous year papers.
        </p>
      </div>
      {branches.length > 1 && (
        <div className="tabs" role="group" aria-label="Filter by branch">
          {[
            ["", "All"],
            ...branches.map((b) => [b.code || b.slug, b.code || b.name]),
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={branch === value}
              className={branch === value ? "active" : ""}
              onClick={() => setParams(value ? { branch: value } : {})}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {list.isPending ? (
        <Skeleton count={4} />
      ) : list.isError ? (
        <ErrorState retry={() => list.refetch()} />
      ) : !shown.length ? (
        <div className="empty card">
          <BookOpenCheck size={32} />
          <h3>Syllabus coming soon</h3>
          <p>We are adding the syllabus subject by subject.</p>
          <Link className="button secondary" to="/papers">
            Browse papers meanwhile <ArrowUpRight size={16} />
          </Link>
        </div>
      ) : (
        [...bySemester.entries()]
          .sort(([a], [b]) => a - b)
          .map(([sem, entries]) => (
            <section key={sem} className="syllabus-semester">
              <h2>{sem ? `Semester ${sem}` : "Other subjects"}</h2>
              <div className="syllabus-grid">
                {entries
                  .sort((a, b) => a.subject.code.localeCompare(b.subject.code))
                  .map((entry) => (
                    <Link
                      key={entry._id}
                      className="card syllabus-card"
                      to={`/syllabus/${entry.slug}`}
                    >
                      <span className="eyebrow">{entry.subject.code}</span>
                      <h3>{entry.subject.name}</h3>
                      <p>{placement(entry)}</p>
                      <span className="job-cta">
                        Read syllabus <ArrowUpRight size={15} />
                      </span>
                    </Link>
                  ))}
              </div>
            </section>
          ))
      )}
    </main>
  );
}

export function SyllabusPage() {
  const { slug = "" } = useParams();
  const query = useQuery({
    queryKey: ["syllabus", slug],
    queryFn: async () =>
      (await api.get(`/syllabus/${encodeURIComponent(slug)}`)).data
        .data as SyllabusEntry,
    retry: false,
  });
  const entry = query.data;
  const where = entry ? placement(entry) : "";
  const units = unitTitles(entry?.markdown);
  usePageMeta(
    entry
      ? `${entry.subject.name} (${entry.subject.code}) syllabus – BU Bhopal B.Tech`
      : "Syllabus",
    entry
      ? `${entry.subject.name} (${entry.subject.code}) syllabus for ${UNIVERSITY} (BUIT Bhopal) B.Tech, ${where}${units.length ? `. Units: ${units.join(", ")}` : ""}. With previous year question papers.`
      : undefined,
    { noindex: query.isError },
  );
  if (query.isPending)
    return (
      <main className="page">
        <Skeleton count={3} />
      </main>
    );
  if (!entry)
    return (
      <main className="page">
        <div className="empty card">
          <h1>Syllabus not found</h1>
          <p>{errorMessage(query.error)}</p>
          <Link className="button secondary" to="/syllabus">
            All syllabus
          </Link>
        </div>
      </main>
    );
  const credits = creditsText(entry.credits);
  return (
    <main className="page syllabus-detail">
      <Link className="back-link" to="/syllabus">
        <ArrowLeft size={16} /> All syllabus
      </Link>
      <div className="page-heading">
        <div className="eyebrow">{entry.subject.code} · SYLLABUS</div>
        <h1>
          {entry.subject.name} ({entry.subject.code}) syllabus
        </h1>
        {entry.subtitle && (
          <p className="syllabus-subtitle">{entry.subtitle}</p>
        )}
        <p>
          {[where, credits, `${UNIVERSITY}, Bhopal`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="syllabus-layout">
        <article className="card markdown syllabus-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
          >
            {entry.markdown || ""}
          </ReactMarkdown>
        </article>
        <aside className="card syllabus-aside">
          <h2>
            <FileText size={18} aria-hidden /> Previous year papers
          </h2>
          {entry.offerings.length ? (
            <ul>
              {entry.offerings.map((o) => (
                <li key={o._id}>
                  <Link to={subjectPagePath(o, entry.subject.slug)}>
                    {entry.subject.code} papers ·{" "}
                    {o.branch.code || o.branch.name} {o.semester.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <Link to="/papers">Search all question papers</Link>
            </p>
          )}
          <p className="syllabus-note">
            Check the latest syllabus with your department before exams; it can
            change between sessions.
          </p>
        </aside>
      </div>
    </main>
  );
}
