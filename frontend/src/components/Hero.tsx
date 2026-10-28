import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import SearchBox from "./SearchBox";
import CreatorLink from "./CreatorLink";
import { EarnSticky } from "./Earn";
import { PdfThumbnail } from "./PdfThumbnail";
import { contentPath, type ContentItem, type Entity } from "../lib/types";
import { branchPath } from "../lib/branches";

/** The home hero is an answer sheet: exam header, a red-pen title and OMR bubbles for branches. */
export default function Hero({
  papers,
  branches = [],
  programs = [],
}: {
  papers: ContentItem[];
  branches?: Entity[];
  programs?: Entity[];
}) {
  const examples = [
    ...new Set(
      papers
        .flatMap((p) => [p.offerings[0]?.subject.code, p.year?.toString()])
        .filter((v): v is string => !!v),
    ),
  ].slice(0, 3);
  const year = new Date().getFullYear();
  const [top, ...rest] = papers;
  return (
    <section className="eh-hero" aria-labelledby="hero-title">
      <div className="eh-sheet">
        <div className="eh-sheet-head">
          <span>BARKATULLAH UNIVERSITY, BHOPAL</span>
          <span className="eh-roll" aria-hidden="true">
            Roll No.
            {[...`BUIT${String(year).slice(2)}01`].map((d, i) => (
              <i key={i}>{d}</i>
            ))}
          </span>
        </div>
        <div className="eh-sheet-meta">
          <span>B.Tech Examination {year}</span>
          <span>All branches · All semesters</span>
          <span>Time: whenever you’re ready</span>
          <span>Max. Marks: 100</span>
        </div>
        <p className="eh-instructions">
          <strong>Note:</strong> Attempt all questions. Previous year papers{" "}
          <em>are</em> allowed.
        </p>
        <h1 id="hero-title">
          Your next exam,
          <br />
          <span className="eh-underlined">
            made easier.
            <svg
              viewBox="0 0 300 20"
              aria-hidden="true"
              preserveAspectRatio="none"
            >
              <path d="M4 14 C 70 4, 150 4, 296 10 M 30 17 C 110 10, 200 11, 280 15" />
            </svg>
          </span>
        </h1>
        <p className="eh-lead">
          Previous year question papers and short notes for every BUIT branch
          and semester. Free, in one place, made by students.
        </p>
        <SearchBox large examples={examples} />
        {!!examples.length && (
          <div className="hero-hints">
            <span>TRY</span>
            {examples.map((q) => (
              <Link key={q} to={`/papers?q=${encodeURIComponent(q)}`}>
                {q}
              </Link>
            ))}
            <kbd className="hero-shortcut">
              {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} K
            </kbd>
          </div>
        )}
        {!!branches.length && (
          <div className="eh-omr" role="group" aria-labelledby="omr-label">
            <span id="omr-label" className="eh-omr-label">
              Q. Mark your branch
            </span>
            <div className="eh-omr-options">
              {branches.slice(0, 8).map((branch) => (
                <Link key={branch._id} to={branchPath(branch, programs)}>
                  <span className="eh-bubble" aria-hidden="true" />
                  {branch.code || branch.name}
                </Link>
              ))}
            </div>
          </div>
        )}
        <p className="eh-setter">
          Paper set by <CreatorLink />
        </p>
        <span className="eh-score" aria-hidden="true">
          100
          <small>100</small>
        </span>
      </div>
      <div className="eh-desk" aria-label="From the archive">
        <span className="eh-stamp" aria-hidden="true">
          EXAM
          <br />
          READY
        </span>
        <div className="eh-desk-stack">
          {rest.slice(0, 2).map((paper, i) => (
            <div
              key={paper._id}
              className={`eh-desk-under under-${i + 1}`}
              aria-hidden="true"
            />
          ))}
          {top ? (
            <Link className="eh-desk-paper" to={contentPath(top)}>
              <span className="eh-staple" aria-hidden="true" />
              <PdfThumbnail
                id={top._id}
                available={top.hasThumbnail}
                thumbKey={top.thumbKey}
                large
              />
              <span className="eh-desk-caption">
                <strong>{top.offerings[0]?.subject.name || top.title}</strong>
                <span>
                  {[top.offerings[0]?.subject.code, top.year]
                    .filter(Boolean)
                    .join(" · ")}
                  <ArrowUpRight size={15} />
                </span>
              </span>
            </Link>
          ) : (
            <div className="eh-desk-paper eh-desk-blank">
              <span className="eh-staple" aria-hidden="true" />
              <span className="eh-hand">Your next paper goes here.</span>
            </div>
          )}
        </div>
        <EarnSticky className="eh-desk-sticky" />
        <span className="eh-pencil" aria-hidden="true" />
      </div>
    </section>
  );
}

export function CountUp({ value }: { value: number }) {
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - start) / 360, 1);
        node.textContent = Math.round(
          value * (1 - Math.pow(1 - progress, 3)),
        ).toLocaleString();
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return (
    <strong>
      <span className="sr-only">{value.toLocaleString()}</span>
      <span ref={element} aria-hidden="true">
        {value.toLocaleString()}
      </span>
    </strong>
  );
}
