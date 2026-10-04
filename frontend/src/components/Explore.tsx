import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ArrowUpRight, ChevronDown, ScanLine } from "lucide-react";
import { usePublic } from "../lib/queries";
import { branchIdentity, branchPath } from "../lib/branches";
import type { ContentItem, Entity, Offering } from "../lib/types";
import { Empty, Skeleton } from "./ui";

export default function Explore() {
  const [visible, setVisible] = useState(false);
  const branches = usePublic<Entity[]>("/branches"),
    programs = usePublic<Entity[]>("/programs", {}, visible),
    offerings = usePublic<Offering[]>("/offerings", {}, visible);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "150px" },
    );
    if (section.current) observer.observe(section.current);
    return () => observer.disconnect();
  }, []);
  return (
    <section
      className="library-section explore-section"
      id="explore"
      ref={section}
    >
      <div className="section-head">
        <div>
          <div className="eyebrow">01 / FIND YOUR STARTING POINT</div>
          <h2>
            Your course.
            <br className="mobile-only" /> Your corner.
          </h2>
        </div>
        <span className="section-note">
          Six branches.
          <br />A world of possibilities.
        </span>
      </div>
      <div className="explore-bento">
        <PaperFinder
          branches={branches.data?.data || []}
          offerings={offerings.data?.data || []}
          loading={offerings.isPending}
        />
        <div className="branch-grid">
          {branches.isPending ? (
            <Skeleton count={6} />
          ) : (
            branches.data?.data.map((branch) => (
              <BranchCard
                key={branch._id}
                branch={branch}
                programs={programs.data?.data || []}
                offerings={offerings.data?.data || []}
                visible={visible}
              />
            ))
          )}
          {branches.isError && (
            <Empty
              title="Courses are taking a moment"
              message="Try reloading the library shortly."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function PaperFinder({
  branches,
  offerings,
  loading,
}: {
  branches: Entity[];
  offerings: Offering[];
  loading: boolean;
}) {
  const [branch, setBranch] = useState(""),
    [semester, setSemester] = useState(""),
    [subject, setSubject] = useState("");
  const navigate = useNavigate();
  const relevant = offerings.filter((o) => o.branch._id === branch);
  const semesters = [
    ...new Map(relevant.map((o) => [o.semester._id, o.semester])).values(),
  ].sort((a, b) => (a.number || 0) - (b.number || 0));
  const subjects = [
    ...new Map(
      relevant
        .filter((o) => o.semester._id === semester)
        .map((o) => [o.subject._id, o.subject]),
    ).values(),
  ];
  const chosen = relevant.find(
    (o) => o.semester._id === semester && o.subject._id === subject,
  );
  return (
    <form
      className="finder card"
      aria-label="Find your paper in 3 steps"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen)
          navigate(
            `/subjects/${chosen.program.slug}/${chosen.branch.slug}/sem-${chosen.semester.number}/${chosen.subject.slug}`,
          );
      }}
    >
      <div className="finder-symbol">
        <ScanLine size={25} />
        <span>
          LESS SEARCHING.
          <br />
          MORE STUDYING.
        </span>
      </div>
      <h3>
        Three steps.
        <br />
        Your next paper.
      </h3>
      <p>Start where you are. We’ll find the right shelf.</p>
      <div className="finder-steps">
        <label>
          <span>
            <b>01</b> Branch
          </span>
          <select
            value={branch}
            aria-label="Branch"
            onChange={(e) => {
              setBranch(e.target.value);
              setSemester("");
              setSubject("");
            }}
          >
            <option value="">Choose your branch</option>
            {branches.map((b) => (
              <option key={b._id} value={b._id}>
                {b.code || b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            <b>02</b> Semester
          </span>
          <select
            value={semester}
            aria-label="Semester"
            disabled={!branch || !semesters.length}
            onChange={(e) => {
              setSemester(e.target.value);
              setSubject("");
            }}
          >
            <option value="">Choose your semester</option>
            {semesters.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            <b>03</b> Subject
          </span>
          <select
            value={subject}
            aria-label="Subject"
            disabled={!semester}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value="">Choose your subject</option>
            {subjects.map((s) => (
              <option key={s._id} value={s._id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {branch && !semesters.length && !loading && (
        <p className="finder-message" role="status">
          This branch’s subjects are on their way.{" "}
          <Link to="/contact?request=true">Request a paper ↗</Link>
        </p>
      )}
      <button className="button full" disabled={!chosen}>
        Find my papers <ArrowRight size={17} />
      </button>
    </form>
  );
}

function BranchCard({
  branch,
  programs,
  offerings,
  visible,
}: {
  branch: Entity;
  programs: Entity[];
  offerings: Offering[];
  visible: boolean;
}) {
  const { Icon, color, label } = branchIdentity(branch.code);
  const count = usePublic<ContentItem[]>(
    "/papers",
    { branch: branch._id, limit: 1 },
    visible,
  );
  const total = count.data?.meta?.total;
  const semesters = [
    ...new Map(
      offerings
        .filter((o) => o.branch._id === branch._id)
        .map((o) => [o.semester._id, o.semester]),
    ).values(),
  ].sort((a, b) => (a.number || 0) - (b.number || 0));
  const path = branchPath(branch, programs);
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLElement>(null);
  const popupId = `semesters-${branch._id}`;
  function spotlight(event: React.PointerEvent<HTMLElement>) {
    if (
      !matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)")
        .matches
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--spot-x",
      `${event.clientX - rect.left}px`,
    );
    event.currentTarget.style.setProperty(
      "--spot-y",
      `${event.clientY - rect.top}px`,
    );
  }
  return (
    <article
      ref={card}
      className={`branch-card card ${open ? "is-open" : ""}`}
      style={{ "--branch": color } as CSSProperties}
      onPointerMove={spotlight}
      onPointerEnter={(e) => {
        if (
          e.pointerType === "mouse" &&
          matchMedia("(min-width: 900px) and (hover: hover)").matches
        )
          setOpen(true);
      }}
      onPointerLeave={() => {
        if (!card.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <Link
        className="branch-main"
        to={path}
        aria-label={`${branch.code || branch.name} — ${branch.name}`}
      >
        <div className="branch-top">
          <span className="branch-icon">
            <Icon size={25} />
          </span>
          <ArrowUpRight size={17} />
        </div>
        <h3>{branch.code || branch.name}</h3>
        <p>{branch.name}</p>
        <span className="branch-tagline">{label}</span>
      </Link>
      <div className="branch-bottom">
        <span>
          {total === undefined
            ? "Checking archive…"
            : total > 0
              ? `${total} paper${total === 1 ? "" : "s"}`
              : "Growing soon"}
          {count.data?.saved && " · saved"}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={popupId}
          onClick={() => setOpen((v) => !v)}
          aria-label={`${branch.code} semesters`}
        >
          <ChevronDown size={17} />
        </button>
      </div>
      {open && (
        <div className="semester-popover" id={popupId}>
          <span className="eyebrow">JUMP TO A SEMESTER</span>
          {semesters.length ? (
            <div>
              {semesters.map((s) => (
                <Link
                  key={s._id}
                  aria-label={s.name}
                  to={`${path}${path.includes("?") ? "&" : "?"}semester=${s._id}`}
                >
                  {s.number}
                </Link>
              ))}
            </div>
          ) : (
            <Link className="text-link" to="/contact?request=true">
              Request the first paper <ArrowUpRight size={14} />
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
