import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
export default function Dashboard() {
  const query = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => (await api.get("/admin/dashboard")).data.data,
  });
  if (query.isPending) return <p role="status">Loading dashboard…</p>;
  if (!query.data)
    return <p className="notice error">{errorMessage(query.error)}</p>;
  return (
    <>
      <div className="section-head">
        <h2>Library overview</h2>
        <Link className="button secondary" to="/admin/upload">
          Upload a resource
        </Link>
      </div>
      <div className="stat-cards">
        {Object.entries(query.data).map(([key, value]) => (
          <div className="card" key={key}>
            <strong>{String(value)}</strong>
            <span>
              {key === "pending"
                ? "Pending approvals"
                : key === "visitors"
                  ? "Today’s visitors"
                  : key.charAt(0).toUpperCase() + key.slice(1)}
            </span>
          </div>
        ))}
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
