import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, errorMessage } from "../../lib/api";
import { useThemeColors } from "../../lib/useThemeColors";

type Counter =
  "visitors" | "pageViews" | "downloads" | "contentViews" | "searches";
type Stats = Record<Counter, number> & { day: string };
type Row = {
  kind?: string;
  key?: string;
  title: string;
  type?: "papers" | "notes";
  slug?: string;
  count: number;
  zeroResults: number;
};
type Report = {
  days: number;
  timeseries: Stats[];
  today: Stats;
  yesterday: Stats;
  totals: Record<Counter, number>;
  previous: Record<Counter, number>;
  lists: {
    downloads: Row[];
    viewed: Row[];
    subjects: Row[];
    searches: Row[];
    gaps: Row[];
  };
  downloads: {
    hours: { hour: number; downloads: number }[];
    types: Record<string, number>;
    branches: Record<string, number>;
    semesters: Record<string, number>;
    uniqueDownloaders: number;
  };
  breakdown: Record<string, Record<string, number>>;
};
type LogRow = {
  _id: string;
  at: string;
  kind: "papers" | "notes";
  title: string;
  slug?: string;
  subjects?: string[];
  branches?: string[];
  semesters?: string[];
  year?: number;
  examType?: string;
  visitor: string;
  staff?: boolean;
  userName?: string;
  userRole?: string;
  device?: string;
  os?: string;
  browser?: string;
  country?: string;
  page?: string;
};
type Log = { rows: LogRow[]; total: number; page: number; pages: number };

const ranges = [7, 14, 30, 90];
const kpis: [Counter, string][] = [
  ["visitors", "Unique visitors"],
  ["pageViews", "Page views"],
  ["contentViews", "Resource views"],
  ["searches", "Searches"],
  ["downloads", "Downloads"],
];
const typeLabel = (kind?: string) =>
  kind === "notes" ? "Note" : kind === "papers" ? "Paper" : "—";
const resourceUrl = (kind?: string, slug?: string) =>
  slug ? (kind === "notes" ? `/notes/${slug}` : `/paper/${slug}`) : undefined;
const time = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

async function saveCsv(path: string, params: object, filename: string) {
  const response = await api.get(path, { params, responseType: "blob" }),
    url = URL.createObjectURL(response.data),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before)
    return <small className="delta">{now ? "New this period" : "—"}</small>;
  const change = Math.round(((now - before) / before) * 100);
  return (
    <small className={`delta ${change > 0 ? "up" : change < 0 ? "down" : ""}`}>
      {change > 0 ? "▲" : change < 0 ? "▼" : "■"} {Math.abs(change)}% vs
      previous
    </small>
  );
}

/** Ranked horizontal bars; the value and share are always printed, never colour-only. */
function BarList({
  values,
  empty = "No data yet.",
  format = (label: string) => label,
  limit = 8,
}: {
  values: Record<string, number>;
  empty?: string;
  format?: (label: string) => string;
  limit?: number;
}) {
  const rows = Object.entries(values)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  const total = Object.values(values).reduce((n, v) => n + v, 0),
    max = rows[0]?.[1] || 1;
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="bar-list">
      {rows.map(([label, count]) => (
        <li key={label}>
          <div className="bar-list-label">
            <span>{format(label)}</span>
            <span>
              {count}
              <small> · {Math.round((count / total) * 100)}%</small>
            </span>
          </div>
          <div className="bar-list-track" aria-hidden>
            <i style={{ width: `${(count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RankTable({
  rows,
  unit,
  empty,
  showType = true,
}: {
  rows: Row[];
  unit: string;
  empty: string;
  showType?: boolean;
}) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  const max = rows[0].count || 1;
  return (
    <ol className="rank-list">
      {rows.slice(0, 10).map((row, i) => {
        const url = resourceUrl(row.type, row.slug);
        return (
          <li key={`${row.key}-${i}`}>
            <span className="rank">{i + 1}</span>
            <div>
              {url ? (
                <Link to={url} target="_blank" className="text-link">
                  {row.title}
                </Link>
              ) : (
                <span>{row.title}</span>
              )}
              {showType && row.type && (
                <span className="pill">{typeLabel(row.type)}</span>
              )}
              <div className="bar-list-track" aria-hidden>
                <i style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
            </div>
            <strong>
              {row.count} <small>{unit}</small>
            </strong>
          </li>
        );
      })}
    </ol>
  );
}

function DownloadLog({ days }: { days: number }) {
  const [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [kind, setKind] = useState(""),
    [audience, setAudience] = useState("all"),
    [message, setMessage] = useState("");
  const params = {
    days,
    page,
    limit: 25,
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(kind ? { kind } : {}),
    audience,
  };
  const log = useQuery({
    queryKey: ["analytics-downloads", params],
    queryFn: async () =>
      (await api.get("/admin/analytics/downloads", { params })).data
        .data as Log,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const reset =
    <T,>(set: (v: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  return (
    <section className="card staff-card analytics-section">
      <div className="analytics-card-head">
        <div>
          <h3>Who downloaded what</h3>
          <p className="muted">
            Every download in the selected range, newest first. Refreshes every
            minute.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() =>
            saveCsv(
              "/admin/analytics/downloads.csv",
              { ...params, page: undefined, limit: undefined },
              "buit-downloads.csv",
            ).catch((error) => setMessage(errorMessage(error)))
          }
        >
          Export downloads CSV
        </button>
      </div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search title, subject, visitor ID or staff name…"
          value={q}
          onChange={(e) => reset(setQ)(e.target.value)}
          aria-label="Search downloads"
        />
        <select
          value={kind}
          onChange={(e) => reset(setKind)(e.target.value)}
          aria-label="Resource type"
        >
          <option value="">Papers & notes</option>
          <option value="papers">Papers only</option>
          <option value="notes">Notes only</option>
        </select>
        <select
          value={audience}
          onChange={(e) => reset(setAudience)(e.target.value)}
          aria-label="Who downloaded"
        >
          <option value="all">Everyone</option>
          <option value="students">Students / visitors</option>
          <option value="staff">Staff (signed in)</option>
        </select>
      </div>
      {message && <p className="notice error">{message}</p>}
      {log.isError && <p className="notice error">{errorMessage(log.error)}</p>}
      {log.data && (
        <>
          <p className="muted" style={{ fontSize: 12 }}>
            {log.data.total} download{log.data.total === 1 ? "" : "s"} found
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>WHEN</th>
                  <th>RESOURCE</th>
                  <th>SUBJECT · BRANCH · SEM</th>
                  <th>DOWNLOADED BY</th>
                  <th>DEVICE</th>
                  <th>FROM PAGE</th>
                </tr>
              </thead>
              <tbody>
                {log.data.rows.map((row) => {
                  const url = resourceUrl(row.kind, row.slug);
                  return (
                    <tr key={row._id}>
                      <td>
                        {time.format(new Date(row.at))}
                        <br />
                        <small className="muted">{ago(row.at)}</small>
                      </td>
                      <td>
                        {url ? (
                          <Link to={url} target="_blank" className="text-link">
                            {row.title}
                          </Link>
                        ) : (
                          row.title
                        )}
                        <br />
                        <span className="pill">{typeLabel(row.kind)}</span>{" "}
                        {row.year && (
                          <small className="muted">
                            {row.year}
                            {row.examType && row.examType !== "Unknown"
                              ? ` · ${row.examType}`
                              : ""}
                          </small>
                        )}
                      </td>
                      <td>
                        {row.subjects?.join(", ") || "—"}
                        <br />
                        <small className="muted">
                          {[row.branches?.join(", "), row.semesters?.join(", ")]
                            .filter(Boolean)
                            .join(" · ") || ""}
                        </small>
                      </td>
                      <td>
                        {row.staff ? (
                          <>
                            <strong>{row.userName || "Staff member"}</strong>
                            <br />
                            <span className="status pending">
                              {row.userRole || "staff"}
                            </span>
                          </>
                        ) : (
                          <>
                            Visitor <code>{row.visitor}</code>
                            <br />
                            <small className="muted">
                              {row.country && row.country !== "Unknown"
                                ? row.country
                                : "Location unknown"}
                            </small>
                          </>
                        )}
                      </td>
                      <td>
                        {row.device || "—"}
                        <br />
                        <small className="muted">
                          {[row.os, row.browser].filter(Boolean).join(" · ")}
                        </small>
                      </td>
                      <td>
                        <small className="muted">{row.page || "—"}</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!log.data.rows.length && (
            <p className="muted">
              No downloads match. New downloads appear here as soon as they
              happen.
            </p>
          )}
          {log.data.pages > 1 && (
            <div className="pager">
              <button
                className="button secondary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                ← Newer
              </button>
              <span className="muted">
                Page {log.data.page} of {log.data.pages}
              </span>
              <button
                className="button secondary"
                disabled={page >= log.data.pages}
                onClick={() => setPage(page + 1)}
              >
                Older →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function Analytics() {
  const [days, setDays] = useState(30),
    [message, setMessage] = useState(""),
    query = useQuery({
      queryKey: ["analytics", days],
      queryFn: async () =>
        (await api.get("/admin/analytics", { params: { days } })).data
          .data as Report,
      placeholderData: keepPreviousData,
    });
  const data = query.data,
    colors = useThemeColors();
  const tooltip = {
    contentStyle: {
      background: colors.raised,
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
    },
  };
  const series: [Counter, string, string][] = [
    ["visitors", "Visitors", colors.primary],
    ["pageViews", "Page views", colors.success],
    ["downloads", "Downloads", colors.accent],
  ];
  return (
    <>
      <div className="section-head">
        <h2>Understand the library.</h2>
        <div className="toolbar">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Analytics date range"
          >
            {ranges.map((n) => (
              <option key={n} value={n}>
                Last {n} days
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            onClick={() =>
              saveCsv(
                "/admin/analytics/export.csv",
                { days },
                "buit-analytics.csv",
              ).catch((error) => setMessage(errorMessage(error)))
            }
          >
            Export daily CSV
          </button>
        </div>
      </div>
      {message && <p className="notice error">{message}</p>}
      {query.isPending && <p role="status">Loading analytics…</p>}
      {query.isError && (
        <p className="notice error">{errorMessage(query.error)}</p>
      )}
      {data && (
        <>
          <div className="stat-cards kpi-cards">
            {kpis.map(([key, label]) => (
              <div className="card" key={key}>
                <strong>{data.totals[key].toLocaleString("en-IN")}</strong>
                <span>
                  {label} · {days}d
                </span>
                <Delta now={data.totals[key]} before={data.previous[key]} />
                <small className="muted">
                  Today {data.today?.[key] || 0} · Yesterday{" "}
                  {data.yesterday?.[key] || 0}
                </small>
              </div>
            ))}
            <div className="card">
              <strong>
                {data.downloads.uniqueDownloaders.toLocaleString("en-IN")}
              </strong>
              <span>Unique downloaders · {days}d</span>
              <small className="muted">
                {data.downloads.uniqueDownloaders
                  ? `${(data.totals.downloads / data.downloads.uniqueDownloaders).toFixed(1)} downloads each`
                  : "Counted per visitor per day"}
              </small>
            </div>
          </div>

          <section className="card staff-card analytics-section">
            <div className="analytics-card-head">
              <h3>Daily traffic</h3>
              <span className="legend">
                {series.map(([key, label, color]) => (
                  <span key={key}>
                    <i style={{ background: color }} /> {label}
                  </span>
                ))}
              </span>
            </div>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.timeseries}
                  margin={{ top: 15, right: 15, left: -20, bottom: 5 }}
                >
                  <CartesianGrid stroke={colors.border} vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: colors.muted, fontSize: 10 }}
                    tickFormatter={(day: string) => day.slice(5)}
                    minTickGap={25}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: colors.muted, fontSize: 10 }}
                  />
                  <Tooltip {...tooltip} />
                  {series.map(([key, label, color]) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={label}
                      stroke={color}
                      strokeWidth={2}
                      fill={color}
                      fillOpacity={key === "visitors" ? 0.12 : 0}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="analytics-grid">
            <section className="card staff-card">
              <h3>Most downloaded</h3>
              <RankTable
                rows={data.lists.downloads}
                unit="downloads"
                empty="No downloads in this range yet."
              />
            </section>
            <section className="card staff-card">
              <h3>Most viewed</h3>
              <RankTable
                rows={data.lists.viewed}
                unit="views"
                empty="No resource views in this range yet."
              />
            </section>
          </div>

          <div className="analytics-grid">
            <section className="card staff-card">
              <h3>Downloads by hour (IST)</h3>
              <p className="muted">When students download the most.</p>
              <div className="chart chart-short">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.downloads.hours}
                    margin={{ top: 10, right: 5, left: -25, bottom: 0 }}
                  >
                    <CartesianGrid stroke={colors.border} vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: colors.muted, fontSize: 10 }}
                      tickFormatter={(h: number) => `${h}`}
                      interval={2}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: colors.muted, fontSize: 10 }}
                    />
                    <Tooltip
                      {...tooltip}
                      cursor={{ fill: colors.border, opacity: 0.4 }}
                      labelFormatter={(h) =>
                        `${String(h).padStart(2, "0")}:00 – ${String(h).padStart(2, "0")}:59`
                      }
                    />
                    <Bar
                      dataKey="downloads"
                      name="Downloads"
                      fill={colors.accent}
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="card staff-card">
              <h3>Downloads by audience</h3>
              <div className="split-lists">
                <div>
                  <h4>Branch</h4>
                  <BarList values={data.downloads.branches} limit={6} />
                </div>
                <div>
                  <h4>Semester</h4>
                  <BarList values={data.downloads.semesters} limit={6} />
                </div>
              </div>
              <h4>Type</h4>
              <BarList
                values={data.downloads.types}
                format={(k) =>
                  k === "notes" ? "Short notes" : "Question papers"
                }
              />
            </section>
          </div>

          <div className="analytics-grid three">
            <section className="card staff-card">
              <h3>Popular subjects</h3>
              <RankTable
                rows={data.lists.subjects}
                unit="views"
                empty="No subject activity yet."
                showType={false}
              />
            </section>
            <section className="card staff-card">
              <h3>Top searches</h3>
              <BarList
                values={Object.fromEntries(
                  data.lists.searches.map((r) => [r.title, r.count]),
                )}
                empty="No searches yet."
              />
            </section>
            <section className="card staff-card">
              <h3>Search gaps</h3>
              <p className="muted">
                Searches that returned nothing — upload these.
              </p>
              <BarList
                values={Object.fromEntries(
                  data.lists.gaps.map((r) => [r.title, r.zeroResults]),
                )}
                empty="Every search found something."
              />
            </section>
          </div>

          <div className="analytics-grid three">
            {(
              [
                ["devices", "Devices"],
                ["os", "Operating systems"],
                ["browsers", "Browsers"],
                ["countries", "Countries"],
                ["referrers", "Traffic sources"],
              ] as const
            ).map(([category, title]) => (
              <section className="card staff-card" key={category}>
                <h3>{title}</h3>
                <BarList
                  values={data.breakdown[category] || {}}
                  format={(label) => label.replace(/_/g, ".")}
                />
              </section>
            ))}
          </div>

          <DownloadLog days={days} />

          <p className="muted" style={{ fontSize: 11 }}>
            Daily boundaries use Asia/Kolkata. Visitors are approximate daily
            uniques: a visitor ID is an anonymous hash that changes every day,
            so the same student shows a new ID tomorrow. Staff downloads are
            listed by name but never counted in totals. Do-Not-Track and
            recognized bots are excluded. The download log, OS breakdown and
            resource-view / search totals start from this update.
          </p>
        </>
      )}
    </>
  );
}
