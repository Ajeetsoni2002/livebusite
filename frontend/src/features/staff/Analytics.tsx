import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { api, errorMessage } from "../../lib/api";
type Stats = {
  day: string;
  visitors: number;
  pageViews: number;
  downloads: number;
};
type Report = {
  timeseries: Stats[];
  today: Stats;
  yesterday: Stats;
  top: {
    kind: string;
    title: string;
    key: string;
    count: number;
    zeroResults: number;
  }[];
  breakdown: Record<string, Record<string, number>>;
};
export default function Analytics() {
  const [days, setDays] = useState(30),
    [message, setMessage] = useState(""),
    query = useQuery({
      queryKey: ["analytics", days],
      queryFn: async () =>
        (await api.get("/admin/analytics", { params: { days } })).data
          .data as Report,
    });
  const data = query.data;
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
            {[7, 30, 90].map((n) => (
              <option key={n} value={n}>
                Last {n} days
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                const response = await api.get("/admin/analytics/export.csv", {
                    params: { days },
                    responseType: "blob",
                  }),
                  url = URL.createObjectURL(response.data),
                  link = document.createElement("a");
                link.href = url;
                link.download = "buit-analytics.csv";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (error) {
                setMessage(errorMessage(error));
              }
            }}
          >
            Export CSV
          </button>
        </div>
      </div>
      {message && <p className="notice error">{message}</p>}
      {query.isPending && <p role="status">Loading daily aggregates…</p>}
      {query.isError && (
        <p className="notice error">{errorMessage(query.error)}</p>
      )}
      {data && (
        <>
          <div className="stat-cards">
            {(["visitors", "pageViews", "downloads"] as const).map((key) => (
              <div className="card" key={key}>
                <strong>{data.today?.[key] || 0}</strong>
                <span>
                  Today’s {key === "pageViews" ? "page views" : key}
                  <br />
                  Yesterday: {data.yesterday?.[key] || 0}
                </span>
              </div>
            ))}
          </div>
          <section className="card staff-card">
            <h3>Daily unique visitors</h3>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.timeseries}
                  margin={{ top: 15, right: 15, left: -20, bottom: 5 }}
                >
                  <CartesianGrid stroke="#ffffff10" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "#96a4bd", fontSize: 10 }}
                    tickFormatter={(day) => day.slice(5)}
                    minTickGap={25}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "#96a4bd", fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#142236",
                      border: "1px solid #ffffff20",
                      borderRadius: 8,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="visitors"
                    stroke="#67e8f9"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card staff-card" style={{ marginTop: 24 }}>
            <h3>Top content & search gaps</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>TYPE</th>
                    <th>RESOURCE / SEARCH</th>
                    <th>EVENTS</th>
                    <th>ZERO RESULTS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((row) => (
                    <tr key={`${row.kind}-${row.key}`}>
                      <td>{row.kind}</td>
                      <td>{row.title}</td>
                      <td>{row.count}</td>
                      <td>{row.kind === "search" ? row.zeroResults : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.top.length && (
              <p className="muted">
                Metrics appear as students use the library.
              </p>
            )}
          </section>
          <div className="stat-cards" style={{ marginTop: 24 }}>
            {Object.entries(data.breakdown).map(([category, values]) => (
              <section className="card" key={category}>
                <h3>{category.charAt(0).toUpperCase() + category.slice(1)}</h3>
                {Object.entries(values)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([label, count]) => (
                    <p key={label} style={{ fontSize: 12 }}>
                      {label.replace(/_/g, ".")}{" "}
                      <span className="pill">{count}</span>
                    </p>
                  ))}
                {!Object.keys(values).length && <p>No data yet.</p>}
              </section>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11 }}>
            Daily boundaries use Asia/Kolkata. Visitors are approximate daily
            uniques; download actions represent issued links. Do-Not-Track,
            recognized bots and staff traffic are excluded.
          </p>
        </>
      )}
    </>
  );
}
