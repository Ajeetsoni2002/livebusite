import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Download,
  Eye,
  FileText,
  NotebookPen,
  ShieldCheck,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, errorMessage } from "../../lib/api";
import { CountUp } from "../../components/Hero";
import { useThemeColors } from "../../lib/useThemeColors";

type Overview = {
  papers: number;
  notes: number;
  downloads: number;
  contributors: number;
  pending: number;
  visitors: number;
  requests?: number;
};
type Day = {
  day: string;
  visitors: number;
  pageViews: number;
  downloads: number;
};

const tiles: [keyof Overview, string, LucideIcon, string?][] = [
  ["papers", "Question papers", FileText, "/admin/papers"],
  ["notes", "Short notes", NotebookPen, "/admin/notes"],
  ["downloads", "Total downloads", Download],
  ["contributors", "Contributors", Users, "/admin/contributors"],
  ["visitors", "Visitors today", Eye, "/admin/analytics"],
];

export default function Dashboard() {
  const colors = useThemeColors();
  const query = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () =>
      (await api.get("/admin/dashboard")).data.data as Overview,
  });
  const trend = useQuery({
    queryKey: ["analytics", 14],
    queryFn: async () =>
      (await api.get("/admin/analytics", { params: { days: 14 } })).data.data
        .timeseries as Day[],
  });
  if (query.isPending)
    return (
      <div className="bento" role="status" aria-label="Loading dashboard">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card bento-tile skeleton" />
        ))}
      </div>
    );
  if (!query.data)
    return <p className="notice error">{errorMessage(query.error)}</p>;
  const data = query.data;
  return (
    <>
      <div className="section-head">
        <h2>Library overview</h2>
        <Link className="button secondary" to="/admin/upload">
          <Upload size={16} /> Upload a resource
        </Link>
      </div>
      {!!data.requests && (
        <Link className="notice request-notice" to="/admin/contributors">
          {data.requests} student{data.requests === 1 ? "" : "s"} asked to
          become a contributor. Review account requests →
        </Link>
      )}
      <div className="bento">
        <Link
          to="/admin/moderation"
          className={`card bento-tile bento-pending ${data.pending ? "has-pending" : ""}`}
        >
          <ShieldCheck size={22} aria-hidden />
          <CountUp value={data.pending} />
          <span>Pending approvals</span>
          <small>
            {data.pending
              ? "Review uploads waiting for you"
              : "Moderation queue is clear"}{" "}
            <ArrowRight size={14} />
          </small>
        </Link>
        {tiles.map(([key, label, Icon, to]) => {
          const body = (
            <>
              <Icon size={20} aria-hidden />
              <CountUp value={data[key] ?? 0} />
              <span>{label}</span>
            </>
          );
          return to ? (
            <Link
              key={key}
              to={to}
              className={`card bento-tile ${key === "visitors" ? "bento-wide" : ""}`}
            >
              {body}
            </Link>
          ) : (
            <div
              key={key}
              className={`card bento-tile ${key === "visitors" ? "bento-wide" : ""}`}
            >
              {body}
            </div>
          );
        })}
        <section className="card bento-tile bento-chart">
          <div className="bento-chart-head">
            <h3>Last 14 days</h3>
            <span className="legend">
              <i style={{ background: colors.primary }} /> Visitors
              <i style={{ background: colors.accent }} /> Downloads
            </span>
          </div>
          {trend.data ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={trend.data}
                  margin={{ top: 10, right: 8, left: -24, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="fill-visitors"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={colors.primary}
                        stopOpacity={0.35}
                      />
                      <stop
                        offset="100%"
                        stopColor={colors.primary}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={colors.border} vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: colors.muted, fontSize: 10 }}
                    tickFormatter={(day: string) => day.slice(5)}
                    minTickGap={20}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: colors.muted, fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: colors.raised,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 10,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="visitors"
                    name="Visitors"
                    stroke={colors.primary}
                    strokeWidth={2}
                    fill="url(#fill-visitors)"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="downloads"
                    name="Downloads"
                    stroke={colors.accent}
                    strokeWidth={2}
                    fill="transparent"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="muted">
              {trend.isError ? errorMessage(trend.error) : "Loading trend…"}
            </p>
          )}
        </section>
      </div>
      <div className="card staff-card">
        <h3>Keep the archive accurate.</h3>
        <p>
          Legacy files with conflicting subject or year labels remain in
          moderation. Inspect their source metadata before approving them. No
          empty links have been converted into papers.
        </p>
        <Link className="text-link" to="/admin/moderation">
          Review the moderation queue →
        </Link>
      </div>
    </>
  );
}
