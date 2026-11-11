import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import NotesShowcase from "../../components/NotesShowcase";
import Explore from "../../components/Explore";
import SubjectTicker from "../../components/SubjectTicker";
import Hero, { CountUp } from "../../components/Hero";
import { EarnCheque } from "../../components/Earn";
import {
  ContentCard,
  Empty,
  Skeleton,
  SavedNotice,
  ErrorState,
} from "../../components/ui";
import { usePublic } from "../../lib/queries";
import { usePageMeta } from "../../lib/meta";
import type { Entity, ContentItem } from "../../lib/types";

/** A question heading: "Q.2  Recently added  [link]". */
function Question({
  n,
  title,
  note,
  to,
  link,
}: {
  n: number;
  title: string;
  note?: string;
  to?: string;
  link?: string;
}) {
  return (
    <div className="section-head eh-q-head">
      <span className="eh-q-num">Q.{n}</span>
      <div>
        <h2>{title}</h2>
        {note && <p className="eh-q-note">{note}</p>}
      </div>
      {to && (
        <Link to={to} className="text-link">
          {link} <ArrowRight size={17} />
        </Link>
      )}
    </div>
  );
}

/* What students search for, answered. Keep in step with homeFaq in scripts/prerender.mjs. */
const homeFaq = [
  [
    "Where can I find Barkatullah University previous year question papers?",
    "BUIT Papers collects Barkatullah University (BU Bhopal) B.Tech previous year question papers for every branch – CSE, IT, EC, EX, ME and Civil – sorted by semester, subject and year. Search by subject name or paper code, for example CSE-501 or BE-102.",
  ],
  [
    "Are the papers free to download?",
    "Yes. Every paper and note can be viewed online or downloaded as a PDF for free, without signing up.",
  ],
  [
    "Are first-year (semester 1 and 2) papers included?",
    "Yes. First-year BE papers such as Engineering Mathematics, Chemistry, Physics and Basic Electrical Engineering are common to all branches and appear under every branch.",
  ],
  [
    "Is this the official Barkatullah University website?",
    "No. BUIT Papers is an unofficial archive made by students of BUIT, Bhopal. Papers are shared by students and checked by an admin before they go live.",
  ],
  [
    "Can I share my old papers or notes?",
    "Yes. Create a contributor account, upload clear photos or scans, and earn for every paper or note that is approved.",
  ],
] as const;

export default function Home() {
  usePageMeta(
    "BUIT Papers – Barkatullah University Previous Year Question Papers & Notes",
  );
  const branches = usePublic<Entity[]>("/branches"),
    programs = usePublic<Entity[]>("/programs"),
    recent = usePublic<ContentItem[]>("/papers", { limit: 6 }),
    popular = usePublic<ContentItem[]>("/papers", {
      limit: 3,
      sort: "downloads",
    }),
    notes = usePublic<ContentItem[]>("/notes", { limit: 3 }),
    stats = usePublic<{ papers: number; notes: number; downloads: number }>(
      "/stats",
    );
  const marks = [
    ["Question papers", stats.data?.data.papers],
    ["Short notes", stats.data?.data.notes],
    ["Branches", branches.data?.data.length],
    ["Downloads", stats.data?.data.downloads],
  ].filter((row): row is [string, number] => !!row[1]);
  return (
    <main className="page home-page">
      <Hero
        papers={recent.data?.data || []}
        branches={branches.data?.data || []}
        programs={programs.data?.data || []}
      />
      {!!marks.length && (
        <div className="eh-marksheet" aria-label="Library at a glance">
          <span className="eh-marksheet-title">STATEMENT OF MARKS</span>
          {marks.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <CountUp value={value} />
            </div>
          ))}
          <div className="eh-result">
            <span>Result</span>
            <strong>PASS</strong>
          </div>
        </div>
      )}
      {recent.data?.saved && <SavedNotice />}
      <Explore />
      <SubjectTicker papers={recent.data?.data || []} />
      <section className="library-section">
        <Question
          n={2}
          title="Recently added"
          note="Fresh from the archive."
          to="/papers"
          link="View all papers"
        />
        {recent.isPending ? (
          <Skeleton />
        ) : recent.isError ? (
          <ErrorState
            retry={() => {
              void recent.refetch();
            }}
          />
        ) : recent.data?.data.length ? (
          <div className="content-grid">
            {recent.data.data.map((item) => (
              <ContentCard
                key={item._id}
                item={item}
                saved={recent.data?.saved}
              />
            ))}
          </div>
        ) : (
          <Empty />
        )}
      </section>
      <EarnCheque n={3} />
      {!!popular.data?.data.some((item) => item.downloads > 0) && (
        <section className="library-section popular-section">
          <Question
            n={4}
            title="On everyone’s desk"
            note="The most downloaded papers right now."
            to="/papers?sort=downloads"
            link="Most downloaded"
          />
          <div className="popular-rail">
            {popular.data.data
              .filter((item) => item.downloads > 0)
              .map((item, index) => (
                <div key={item._id}>
                  <span className="popular-rank">#{index + 1}</span>
                  <ContentCard item={item} saved={popular.data?.saved} />
                </div>
              ))}
          </div>
        </section>
      )}
      <NotesShowcase
        notes={notes.data?.data || []}
        saved={notes.data?.saved}
        loading={notes.isPending}
      />
      <section className="eh-faq" aria-labelledby="home-faq">
        <h2 id="home-faq">Questions students ask</h2>
        {homeFaq.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </main>
  );
}
