import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Clock3 } from "lucide-react";
import NotesShowcase from "../../components/NotesShowcase";
import Explore from "../../components/Explore";
import SubjectTicker from "../../components/SubjectTicker";
import Hero, { CountUp } from "../../components/Hero";
import CreatorLink from "../../components/CreatorLink";
import {
  ContentCard,
  Empty,
  Skeleton,
  SavedNotice,
  ErrorState,
} from "../../components/ui";
import { usePublic } from "../../lib/queries";
import type { Entity, ContentItem } from "../../lib/types";
export default function Home() {
  const branches = usePublic<Entity[]>("/branches"),
    recent = usePublic<ContentItem[]>("/papers", { limit: 6 }),
    popular = usePublic<ContentItem[]>("/papers", {
      limit: 3,
      sort: "downloads",
    }),
    notes = usePublic<ContentItem[]>("/notes", { limit: 3 }),
    stats = usePublic<{ papers: number; notes: number; downloads: number }>(
      "/stats",
    );
  return (
    <main className="page home-page">
      <Hero papers={recent.data?.data || []} />
      <div className="stats-strip" aria-label="Library at a glance">
        {(stats.data?.data.papers || 0) > 0 && (
          <div>
            <CountUp value={stats.data!.data.papers} />
            <span>papers. ready for you.</span>
          </div>
        )}
        {!!branches.data?.data.length && (
          <div>
            <CountUp value={branches.data.data.length} />
            <span>branches. one community.</span>
          </div>
        )}
        {(stats.data?.data.notes || 0) > 0 && (
          <div>
            <CountUp value={stats.data!.data.notes} />
            <span>notes to connect the dots.</span>
          </div>
        )}
        {(stats.data?.data.downloads || 0) > 0 && (
          <div>
            <CountUp value={stats.data!.data.downloads} />
            <span>download actions.</span>
          </div>
        )}
        <div className="stats-caption">
          <span className="status-dot" /> A little help goes a long way.
        </div>
      </div>
      {recent.data?.saved && <SavedNotice />}
      <Explore />
      <SubjectTicker papers={recent.data?.data || []} />
      <section className="library-section">
        <div className="section-head">
          <div>
            <div className="eyebrow">
              <Clock3 size={13} /> 02 / FRESH FROM THE ARCHIVE
            </div>
            <h2>Recently added</h2>
          </div>
          <Link to="/papers" className="text-link">
            View all papers <ArrowRight size={17} />
          </Link>
        </div>
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
      {!!popular.data?.data.some((item) => item.downloads > 0) && (
        <section className="library-section popular-section">
          <div className="section-head">
            <div>
              <div className="eyebrow">03 / OPENED. SAVED. STUDIED.</div>
              <h2>On everyone’s desk.</h2>
            </div>
            <Link to="/papers?sort=downloads" className="text-link">
              Most downloaded <ArrowRight size={17} />
            </Link>
          </div>
          <div className="popular-rail">
            {popular.data.data
              .filter((item) => item.downloads > 0)
              .map((item, index) => (
                <div key={item._id}>
                  <span className="popular-rank">0{index + 1}</span>
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
      <section className="contribute-banner">
        <div>
          <div className="eyebrow">GOT A PAPER WE’RE MISSING?</div>
          <h2>Help the next batch get ahead.</h2>
          <p>Every contribution makes the library a little better.</p>
          <p className="contribution-credit">
            Built by <CreatorLink />. Grown by our community.
          </p>
        </div>
        <Link to="/contact" className="button" data-magnetic>
          Get in touch <ArrowUpRight size={18} />
        </Link>
      </section>
    </main>
  );
}
