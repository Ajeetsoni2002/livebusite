import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ArrowDown, Sparkles } from "lucide-react";
import SearchBox from "./SearchBox";
import CreatorLink from "./CreatorLink";
import { PdfThumbnail } from "./PdfThumbnail";
import { contentPath, type ContentItem } from "../lib/types";
const PaperParallax = lazy(() => import("./PaperParallax"));
const HeroScene = lazy(() => import("./HeroScene"));

export default function Hero({ papers }: { papers: ContentItem[] }) {
  const [enhanced, setEnhanced] = useState(false);
  const scene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const capable = matchMedia(
      "(min-width: 900px) and (hover: hover) and (prefers-reduced-motion: no-preference)",
    );
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (
      !capable.matches ||
      connection?.saveData ||
      navigator.hardwareConcurrency <= 2
    )
      return;
    const timer = setTimeout(() => setEnhanced(true), 1200);
    return () => clearTimeout(timer);
  }, []);
  const examples = [
    ...new Set(
      papers
        .flatMap((p) => [p.offerings[0]?.subject.code, p.year?.toString()])
        .filter((v): v is string => !!v),
    ),
  ].slice(0, 3);
  return (
    <section className="hero solar-hero" aria-labelledby="hero-title">
      <div className="hero-intro">
        <div className="hero-label">
          <span className="status-dot" /> BUILT BY STUDENTS. PASSED FORWARD.
        </div>
        <h1 id="hero-title">
          Your next exam.
          <br />
          <span>A little easier.</span>
        </h1>
        <p>
          Past papers. Clearer concepts. A head start.
          <br className="desktop-only" /> Your Barkatullah University study
          archive, all in one place.
        </p>
        <div className="creator-credit">
          Created by <CreatorLink />
        </div>
        <SearchBox large examples={examples} />
        <div className="hero-hints">
          <span>START WITH</span>
          {examples.map((q) => (
            <Link key={q} to={`/papers?q=${encodeURIComponent(q)}`}>
              {q}
              <ArrowUpRight size={12} />
            </Link>
          ))}
          <kbd className="hero-shortcut">
            {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} K
          </kbd>
        </div>
        <a href="#explore" className="hero-explore">
          <ArrowDown size={15} /> Find your course. Find your rhythm.
        </a>
      </div>
      <div className="paper-scene" ref={scene}>
        <div className="scene-grid" aria-hidden="true" />
        <div className="scene-sun" aria-hidden="true" />
        <div className="scene-caption">
          <span className="status-dot" /> FROM THE REAL ARCHIVE
          <span>01 / BUIT</span>
        </div>
        <div className="paper-stack">
          <div className="paper-back back-two" aria-hidden="true" />
          <div className="paper-back back-one" aria-hidden="true" />
          {papers[0] ? (
            <Link className="hero-paper" to={contentPath(papers[0])}>
              <div className="hero-paper-top">
                <span>BUIT / QUESTION PAPER</span>
                <ArrowUpRight size={17} />
              </div>
              <div className="hero-paper-meta">
                <span>{papers[0].offerings[0]?.subject.code || "ARCHIVE"}</span>
                <strong>{papers[0].year || "PDF"}</strong>
              </div>
              <PdfThumbnail
                id={papers[0]._id}
                available={papers[0].hasThumbnail}
                large
              />
              <div className="hero-paper-bottom">
                <strong>
                  {papers[0].offerings[0]?.subject.name || papers[0].title}
                </strong>
                <span>
                  {papers[0].offerings[0]?.semester.name || "Student archive"}
                  <ArrowUpRight size={16} />
                </span>
              </div>
            </Link>
          ) : (
            <div className="hero-paper scene-placeholder">
              <Sparkles size={34} />
              <strong>
                Your next breakthrough
                <br />
                starts with a page.
              </strong>
              <span>BUIT STUDENT ARCHIVE</span>
            </div>
          )}
        </div>
        <div className="scene-tag">
          <Sparkles size={17} />
          <span>
            A little help.
            <br />
            <strong>A better semester.</strong>
          </span>
        </div>
        <div className="scene-footnote">
          COLLECTED WITH CARE. OPEN TO EVERYONE.
        </div>
        {enhanced && (
          <Suspense fallback={null}>
            <HeroScene />
            <PaperParallax scene={scene} />
          </Suspense>
        )}
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
