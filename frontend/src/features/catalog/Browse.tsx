import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Filter,
  Search,
  ArrowLeft,
  ArrowUpRight,
  X,
  ChevronDown,
  PenLine,
  LayoutGrid,
  List,
} from "lucide-react";
import { usePublic } from "../../lib/queries";
import type { Entity, Offering, ContentItem } from "../../lib/types";
import { ContentCard, Empty, SavedNotice, Skeleton } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { usePageMeta } from "../../lib/meta";
import { useEffect, useState, type CSSProperties } from "react";
import { branchIdentity } from "../../lib/branches";
import { track } from "../../lib/analytics";
const sortOptions = [
  ["newest", "Newest added"],
  ["oldest", "Oldest added"],
  ["year-desc", "Year: newest first", "papers"],
  ["year-asc", "Year: oldest first", "papers"],
  ["title", "Title (A–Z)"],
  ["downloads", "Most downloaded"],
  ["views", "Most viewed"],
] as const;
export default function Browse({ kind = "papers" }: { kind?: string }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const params = useParams(),
    [search, setSearch] = useSearchParams(),
    branches = usePublic<Entity[]>("/branches"),
    programs = usePublic<Entity[]>("/programs"),
    semesters = usePublic<Entity[]>("/semesters"),
    subjects = usePublic<Entity[]>("/subjects"),
    offerings = usePublic<Offering[]>("/offerings");
  const program = programs.data?.data.find((p) => p.slug === params.program);
  const branch = branches.data?.data.find(
      (b) =>
        b.slug === params.branch &&
        (!params.program || b.program === program?._id),
    ),
    subject = subjects.data?.data.find((s) => s.slug === params.subject),
    semester = semesters.data?.data.find(
      (s) =>
        `sem-${s.number}` === params.semester &&
        (!params.program || s.program === program?._id),
    );
  const currentKind = subject && search.get("tab") === "notes" ? "notes" : kind;
  const selectedBranch = branch?._id || search.get("branch") || "",
    selectedSubject = subject?._id || search.get("subject") || "",
    selectedSemester = semester?._id || search.get("semester") || "";
  const filter = {
    q: search.get("q") || undefined,
    branch: selectedBranch || undefined,
    subject: selectedSubject || undefined,
    semester: selectedSemester || undefined,
    year: search.get("year") || undefined,
    examType: search.get("examType") || undefined,
    sort: search.get("sort") || "newest",
    page: Number(search.get("page") || 1),
  };
  const items = usePublic<ContentItem[]>(`/${currentKind}`, filter);
  const view = search.get("view") === "list" ? "list" : "grid";
  const sorts = sortOptions.filter(
    (option) => option.length < 3 || option[2] === currentKind,
  );
  const relevant = (offerings.data?.data || []).filter(
    (o) =>
      (!selectedBranch || o.branch._id === selectedBranch) &&
      (!selectedSemester || o.semester._id === selectedSemester),
  );
  const choices = [
    ...new Map(relevant.map((o) => [o.subject._id, o.subject])).values(),
  ];
  useEffect(() => {
    if (filter.q && items.data && !items.data.saved)
      track({ kind: "search", query: filter.q });
  }, [filter.q, items.data?.saved, items.data?.meta?.total]);
  const title =
    subject?.name ||
    branch?.name ||
    (kind === "notes" ? "Short notes" : "Question papers");
  usePageMeta(title);
  const identity = branchIdentity(branch?.code),
    BranchIcon = identity.Icon;
  const branchSemesters = [
    ...new Map(
      (offerings.data?.data || [])
        .filter((o) => o.branch._id === branch?._id)
        .map((o) => [o.semester._id, o.semester]),
    ).values(),
  ].sort((a, b) => (a.number || 0) - (b.number || 0));
  const chips = [
    ["q", search.get("q")],
    [
      "branch",
      !branch &&
        branches.data?.data.find((b) => b._id === selectedBranch)?.code,
    ],
    [
      "semester",
      !semester &&
        semesters.data?.data.find((s) => s._id === selectedSemester)?.name,
    ],
    [
      "subject",
      !subject &&
        subjects.data?.data.find((s) => s._id === selectedSubject)?.code,
    ],
    ["year", search.get("year")],
    ["examType", search.get("examType")],
  ].filter((entry): entry is [string, string] => !!entry[1]);
  function update(key: string, value: string) {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    if (key === "branch") {
      next.delete("semester");
      next.delete("subject");
    }
    if (key === "semester") next.delete("subject");
    setSearch(next);
  }
  return (
    <main
      className={`page browse ${branch ? "branch-browse" : ""} ${currentKind === "notes" ? "notes-browse" : ""}`}
      style={{ "--branch": identity.color } as CSSProperties}
    >
      <Link className="text-link" to="/">
        <ArrowLeft size={15} /> Back to library
      </Link>
      <div className="page-heading">
        {branch && (
          <div className="branch-watermark" aria-hidden="true">
            <BranchIcon size={72} />
            <span>{branch.code}</span>
          </div>
        )}
        <div className="eyebrow">
          {subject?.code || branch?.code || "THE STUDENT LIBRARY"}
        </div>
        <h1>{title}</h1>
        <p>
          {subject
            ? "Papers and notes, together for this subject."
            : branch
              ? "Pick a subject or narrow down by semester."
              : "A good place to start. An even better place to get ahead."}
        </p>
      </div>
      {currentKind === "notes" && !subject && !branch && (
        <div className="notes-welcome">
          <PenLine size={28} />
          <div>
            <h2>A little clarity. Passed forward.</h2>
            <p>
              Subject summaries, revision notes, and explanations from your
              community.
            </p>
          </div>
          <Link className="text-link" to="/contact">
            Share your notes <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
      {branch && !semester && branchSemesters.length > 0 && (
        <div className="semester-tabs" role="group" aria-label="Semesters">
          <button
            aria-pressed={!selectedSemester}
            onClick={() => update("semester", "")}
          >
            All semesters
          </button>
          {branchSemesters.map((s) => (
            <button
              key={s._id}
              aria-pressed={selectedSemester === s._id}
              onClick={() => update("semester", s._id)}
            >
              Semester {s.number}
            </button>
          ))}
        </div>
      )}
      {subject && (
        <div className="tabs">
          <button
            className={currentKind === "papers" ? "active" : ""}
            onClick={() => update("tab", "papers")}
          >
            Papers
          </button>
          <button
            className={currentKind === "notes" ? "active" : ""}
            onClick={() => update("tab", "notes")}
          >
            Notes
          </button>
        </div>
      )}
      <form
        className="filter-search"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          update("q", String(data.get("q") || ""));
        }}
      >
        <Search size={19} />
        <input
          name="q"
          maxLength={120}
          aria-label="Search the catalog"
          defaultValue={search.get("q") || ""}
          key={search.get("q") || ""}
          placeholder="Search by subject, code, year or keyword"
        />
        <button className="button" type="submit">
          Search
        </button>
      </form>
      <button
        className="filter-toggle button secondary"
        aria-expanded={filtersOpen}
        aria-controls="catalog-filters"
        onClick={() => setFiltersOpen((v) => !v)}
      >
        <Filter size={17} />
        Filters{" "}
        {chips.length > 0 && (
          <span className="filter-count">{chips.length}</span>
        )}
        <ChevronDown size={17} />
      </button>
      <div
        className={`filters card ${filtersOpen ? "is-open" : ""}`}
        id="catalog-filters"
      >
        <span>
          <Filter size={17} /> Filters
        </span>
        {!branch && (
          <label>
            <span>Branch</span>
            <select
              aria-label="Branch"
              value={selectedBranch}
              onChange={(e) => {
                update("branch", e.target.value);
              }}
            >
              <option value="">All branches</option>
              {branches.data?.data.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.code || b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!semester && (
          <label>
            <span>Semester</span>
            <select
              aria-label="Semester"
              value={selectedSemester}
              onChange={(e) => update("semester", e.target.value)}
            >
              <option value="">All semesters</option>
              {semesters.data?.data.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!subject && (
          <label>
            <span>Subject</span>
            <select
              aria-label="Subject"
              value={selectedSubject}
              onChange={(e) => update("subject", e.target.value)}
            >
              <option value="">All subjects</option>
              {choices.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {currentKind === "papers" && (
          <>
            <label>
              <span>Year</span>
              <input
                aria-label="Year"
                type="number"
                min="1900"
                max="2200"
                placeholder="Any year"
                value={search.get("year") || ""}
                onChange={(e) => update("year", e.target.value)}
              />
            </label>
            <label>
              <span>Exam type</span>
              <select
                aria-label="Exam type"
                value={search.get("examType") || ""}
                onChange={(e) => update("examType", e.target.value)}
              >
                <option value="">All exams</option>
                {[
                  "Mid-Sem",
                  "End-Sem",
                  "Supplementary",
                  "Other",
                  "Unknown",
                ].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          <span>Sort</span>
          <select
            aria-label="Sort"
            value={
              sorts.some(([value]) => value === filter.sort)
                ? filter.sort
                : "newest"
            }
            onChange={(e) =>
              update("sort", e.target.value === "newest" ? "" : e.target.value)
            }
          >
            {sorts.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="text-link"
          onClick={() =>
            setSearch(
              subject && currentKind === "notes" ? { tab: "notes" } : {},
            )
          }
        >
          Reset
        </button>
        <button
          className="button show-results"
          onClick={() => setFiltersOpen(false)}
        >
          Show results
        </button>
      </div>
      {chips.length > 0 && (
        <div className="filter-chips" aria-label="Active filters">
          {chips.map(([key, value]) => (
            <button
              key={key}
              aria-label={`Remove ${key === "examType" ? "exam type" : key === "q" ? "search" : key} filter`}
              onClick={() => update(key, "")}
            >
              {value}
              <X size={12} />
            </button>
          ))}
          {chips.length > 1 && (
            <button
              className="clear-all"
              onClick={() => {
                const next = new URLSearchParams();
                for (const key of ["sort", "view", "tab"])
                  if (search.get(key)) next.set(key, search.get(key)!);
                setSearch(next);
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}
      {branch && !subject && choices.length > 0 && (
        <details className="subject-directory">
          <summary>
            Browse {choices.length} subjects{" "}
            <span>
              Find a specific subject <ChevronDown size={15} />
            </span>
          </summary>
          <div className="subject-shortcuts">
            {relevant
              .filter(
                (o, i, all) =>
                  all.findIndex(
                    (p) =>
                      p.subject._id === o.subject._id &&
                      p.semester._id === o.semester._id,
                  ) === i,
              )
              .map((o) => (
                <Link
                  key={o._id}
                  to={`/subjects/${o.program.slug}/${o.branch.slug}/sem-${o.semester.number}/${o.subject.slug}`}
                >
                  <span>{o.subject.code}</span>
                  {o.subject.name}
                  <small>{o.semester.name}</small>
                  <ArrowUpRight size={14} />
                </Link>
              ))}
          </div>
        </details>
      )}
      {items.data?.saved && <SavedNotice />}
      <div className="results-summary">
        <span>
          {currentKind === "notes" && items.data?.meta?.total === 0
            ? "The notebook is growing"
            : `${items.data?.meta?.total ?? "…"} ${currentKind === "notes" ? "notes" : "papers"}`}
        </span>
        <div className="view-toggle" role="group" aria-label="Layout">
          <button
            aria-pressed={view === "grid"}
            aria-label="Grid view"
            title="Grid view"
            onClick={() => update("view", "")}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            aria-pressed={view === "list"}
            aria-label="List view"
            title="List view"
            onClick={() => update("view", "list")}
          >
            <List size={16} />
          </button>
        </div>
      </div>
      <h2 className="sr-only">Results</h2>
      {items.isPending ? (
        <>
          <p className="muted" role="status">
            Connecting to the library… The server may be waking up.
          </p>
          <Skeleton />
        </>
      ) : items.isError ? (
        <div className="notice error">
          {errorMessage(items.error)}{" "}
          <button onClick={() => items.refetch()}>Try again</button>
        </div>
      ) : items.data?.data.length ? (
        <div className={`content-grid ${view === "list" ? "list-view" : ""}`}>
          {items.data.data.map((item) => (
            <ContentCard
              key={item._id}
              item={item}
              kind={currentKind}
              saved={items.data?.saved}
            />
          ))}
        </div>
      ) : currentKind === "notes" ? (
        <Empty
          title={
            chips.length
              ? "No notes for these filters yet"
              : "Every great notebook starts somewhere."
          }
          message={
            chips.length
              ? "Try a different subject, or help fill this gap with your notes."
              : "Have an explanation that made things click? Help the next student find that moment."
          }
          actionLabel="Contribute your notes"
          actionTo="/contact"
        />
      ) : (
        <Empty />
      )}
      {(items.data?.meta?.pages || 0) > 1 && (
        <div className="pagination">
          <button
            className="button secondary"
            disabled={filter.page <= 1}
            onClick={() => update("page", String(filter.page - 1))}
          >
            Previous
          </button>
          <span>
            Page {filter.page} of {items.data?.meta?.pages}
          </span>
          <button
            className="button secondary"
            disabled={filter.page >= (items.data?.meta?.pages || 1)}
            onClick={() => {
              const next = new URLSearchParams(search);
              next.set("page", String(filter.page + 1));
              setSearch(next);
            }}
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
