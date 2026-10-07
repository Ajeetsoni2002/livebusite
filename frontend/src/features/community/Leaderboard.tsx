import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Crown,
  Download,
  FileText,
  NotebookPen,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { CSSProperties } from "react";
import { api, errorMessage } from "../../lib/api";
import { usePageMeta } from "../../lib/meta";
import { ErrorState } from "../../components/ui";

type Contributor = {
  rank: number;
  name: string;
  papers: number;
  notes: number;
  total: number;
  downloads: number;
  joinedAt: string;
  firstPublishedAt: string | null;
};

const periods = [
  ["all", "All time"],
  ["year", "This year"],
  ["month", "Last 30 days"],
] as const;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

// Stable hue per name so an avatar keeps its colors across visits.
const hue = (name: string) =>
  [...name].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 360, 7);

/** Badges come only from real fields: rank, counts, downloads, first publication. */
function badges(person: Contributor, earliest: Set<string>) {
  const list: string[] = [];
  if (person.rank === 1) list.push("Top Contributor");
  if (earliest.has(person.name)) list.push("Early Contributor");
  if (person.papers >= 10) list.push("Archive Builder");
  if (person.notes > 0) list.push("Note Maker");
  if (person.downloads >= 100) list.push("Crowd Favourite");
  return list;
}

function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  return (
    <span
      className="contributor-avatar"
      style={
        {
          "--h": hue(name),
          width: size,
          height: size,
          fontSize: Math.round(size * 0.36),
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export default function Leaderboard() {
  usePageMeta("Top contributors");
  const [search, setSearch] = useSearchParams();
  const period = periods.some(([v]) => v === search.get("period"))
    ? (search.get("period") as string)
    : "all";
  const query = useQuery({
    queryKey: ["contributors", period],
    queryFn: async () =>
      (await api.get("/contributors", { params: { period } })).data
        .data as Contributor[],
  });
  const people = query.data || [];
  const earliest = new Set(
    [...people]
      .filter((p) => p.firstPublishedAt)
      .sort(
        (a, b) =>
          Date.parse(a.firstPublishedAt!) - Date.parse(b.firstPublishedAt!),
      )
      .slice(0, 3)
      .map((p) => p.name),
  );
  const podium = [people[1], people[0], people[2]].filter(Boolean);
  return (
    <main className="page community-page">
      <div className="page-heading">
        <div className="eyebrow">BUIT / COMMUNITY</div>
        <h1>
          The people behind <span className="gradient-text">the papers.</span>
        </h1>
        <p>
          Every paper and note here was shared by a student who wanted the next
          batch to have it easier.
        </p>
      </div>
      <div className="tabs period-tabs" role="group" aria-label="Time period">
        {periods.map(([value, label]) => (
          <button
            key={value}
            aria-pressed={period === value}
            onClick={() =>
              setSearch(value === "all" ? {} : { period: value }, {
                replace: true,
              })
            }
          >
            {label}
          </button>
        ))}
      </div>
      {query.isPending ? (
        <div
          className="podium podium-loading"
          role="status"
          aria-label="Loading"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="podium-slot skeleton" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          retry={() => query.refetch()}
          message={`The leaderboard could not load. ${errorMessage(query.error)}`}
        />
      ) : people.length === 0 ? (
        <div className="empty card">
          <Trophy size={32} />
          <h2>
            {period === "all"
              ? "The podium is waiting for its first name."
              : "No new contributions in this period yet."}
          </h2>
          <p>Share a paper or a note and you could be first.</p>
          <Link className="button" to="/contact">
            Contribute a paper <ArrowUpRight size={16} />
          </Link>
        </div>
      ) : (
        <>
          <section className="podium" aria-label="Top three contributors">
            <h2 className="sr-only">Top three contributors</h2>
            {podium.map((person) => (
              <div
                key={person.name}
                className={`podium-slot place-${person.rank}`}
              >
                <div className="podium-person">
                  {person.rank === 1 && (
                    <Crown className="podium-crown" size={26} aria-hidden />
                  )}
                  <Avatar
                    name={person.name}
                    size={person.rank === 1 ? 84 : 68}
                  />
                  <strong>{person.name}</strong>
                  <span>
                    {person.total} contribution{person.total === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="podium-block" aria-hidden="true">
                  <span>{person.rank}</span>
                </div>
                <span className="sr-only">Rank {person.rank}</span>
              </div>
            ))}
          </section>
          <section className="leaderboard" aria-label="Leaderboard">
            <h2 className="sr-only">Leaderboard</h2>
            <ol>
              {people.map((person) => {
                const earned = badges(person, earliest);
                return (
                  <li key={person.name} className="leader-card card" data-tilt>
                    <span
                      className="leader-rank"
                      aria-label={`Rank ${person.rank}`}
                    >
                      {String(person.rank).padStart(2, "0")}
                    </span>
                    <Avatar name={person.name} size={48} />
                    <div className="leader-main">
                      <strong>{person.name}</strong>
                      {earned.length > 0 && (
                        <ul className="leader-badges" aria-label="Badges">
                          {earned.map((badge) => (
                            <li key={badge}>
                              <Sparkles size={12} aria-hidden /> {badge}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <dl className="leader-stats">
                      <div>
                        <dt>
                          <FileText size={14} aria-hidden /> Papers
                        </dt>
                        <dd>{person.papers}</dd>
                      </div>
                      <div>
                        <dt>
                          <NotebookPen size={14} aria-hidden /> Notes
                        </dt>
                        <dd>{person.notes}</dd>
                      </div>
                      <div>
                        <dt>
                          <Download size={14} aria-hidden /> Downloads
                        </dt>
                        <dd>{person.downloads.toLocaleString()}</dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}
      <section className="contribute-cta card">
        <div>
          <span className="eyebrow">YOUR NAME HERE</span>
          <h2>Have a paper the next batch needs?</h2>
          <p>
            Send it our way. We review every upload, credit you on it, and your
            name joins this board.
          </p>
        </div>
        <div className="cta-actions">
          <Link className="button" to="/contact">
            Contribute a paper <ArrowUpRight size={16} />
          </Link>
          <Link className="button secondary" to="/contribute">
            Become a contributor
          </Link>
          <Link className="button secondary" to="/contributor/login">
            Contributor sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
