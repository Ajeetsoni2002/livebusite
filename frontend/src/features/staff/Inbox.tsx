import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
type Entry = {
  _id: string;
  message: string;
  email?: string;
  status: string;
  response?: string;
  createdAt: string;
};
export default function Inbox({ audit = false }: { audit?: boolean }) {
  const [type, setType] = useState("reports"),
    [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["inbox", audit, type],
    queryFn: async () =>
      (await api.get(`/admin/${audit ? "audit" : type}`)).data.data,
  });
  return (
    <>
      <h2>
        {audit ? "Accountability, recorded." : "Reports & paper requests"}
      </h2>
      {!audit && (
        <div className="tabs">
          <button
            className={type === "reports" ? "active" : ""}
            onClick={() => setType("reports")}
          >
            Reports
          </button>
          <button
            className={type === "requests" ? "active" : ""}
            onClick={() => setType("requests")}
          >
            Paper requests
          </button>
        </div>
      )}
      {message && <p className="notice">{message}</p>}
      {audit ? (
        <div className="card table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>ACTOR</th>
                <th>ACTION / RECORD</th>
                <th>IP REFERENCE</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map(
                (record: {
                  _id: string;
                  createdAt: string;
                  actor?: { name: string };
                  action: string;
                  target: string;
                  ipHash: string;
                }) => (
                  <tr key={record._id}>
                    <td>{new Date(record.createdAt).toLocaleString()}</td>
                    <td>{record.actor?.name || "Anonymous"}</td>
                    <td>
                      {record.action}
                      <br />
                      <small>{record.target}</small>
                    </td>
                    <td>{record.ipHash?.slice(0, 12)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 15 }}>
          {query.data?.map((entry: Entry) => (
            <form
              className="card staff-card"
              key={entry._id}
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                try {
                  await api.patch(`/admin/${type}/${entry._id}`, {
                    status: form.get("status"),
                    response: form.get("response"),
                  });
                  await query.refetch();
                  setMessage("Inbox entry updated.");
                } catch (e) {
                  setMessage(errorMessage(e));
                }
              }}
            >
              <span className="eyebrow">
                {new Date(entry.createdAt).toLocaleDateString()} ·{" "}
                {entry.email || "No reply address"}
              </span>
              <p style={{ whiteSpace: "pre-wrap" }}>{entry.message}</p>
              <div className="staff-form">
                <label>
                  Status
                  <select name="status" defaultValue={entry.status}>
                    {["open", "in-progress", "resolved"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Internal note
                  <input
                    name="response"
                    defaultValue={entry.response}
                    maxLength={2000}
                  />
                </label>
                <button className="button secondary">Save</button>
              </div>
            </form>
          ))}
        </div>
      )}
      {!query.isPending && !query.data?.length && (
        <p className="notice">No entries yet.</p>
      )}
    </>
  );
}
