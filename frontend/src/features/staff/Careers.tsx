import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, Plus } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { confirmDialog, toast } from "../../components/Feedback";
import type { JobPost } from "../careers/Jobs";

type AdminPost = JobPost & { active: boolean; applications: number };
type Application = {
  _id: string;
  name: string;
  email: string;
  phone: string;
  branch?: string;
  semester?: number;
  graduationYear?: number;
  college?: string;
  resumeUrl: string;
  note?: string;
  status: "new" | "shortlisted" | "rejected" | "hired";
  createdAt: string;
};

const csvCell = (value: unknown) =>
  `"${String(value ?? "")
    .replace(/"/g, '""')
    // Stop spreadsheet apps from treating a cell as a formula.
    .replace(/^[=+\-@]/, "'$&")}"`;
function downloadCsv(post: AdminPost, rows: Application[]) {
  const columns: (keyof Application)[] = [
    "createdAt",
    "name",
    "email",
    "phone",
    "branch",
    "semester",
    "graduationYear",
    "college",
    "resumeUrl",
    "note",
    "status",
  ];
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(",")),
  ].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `${post.slug}-applications.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function PostForm({ post, onDone }: { post?: AdminPost; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card staff-card staff-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const text = (name: string) => String(form.get(name) || "").trim();
        const body = {
          title: text("title"),
          kind: text("kind"),
          company: text("company"),
          location: text("location"),
          mode: text("mode"),
          pay: text("pay"),
          duration: text("duration"),
          eligibility: text("eligibility"),
          description: text("description"),
          deadline: text("deadline") || null,
          externalUrl: text("externalUrl"),
          active: form.get("active") === "on",
        };
        setBusy(true);
        try {
          if (post) await api.patch(`/admin/careers/${post._id}`, body);
          else await api.post("/admin/careers", body);
          toast(post ? "Opening updated." : "Opening posted.", "success");
          onDone();
        } catch (e) {
          toast(errorMessage(e), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="wide">
        Title
        <input
          name="title"
          required
          minLength={3}
          maxLength={160}
          defaultValue={post?.title}
        />
      </label>
      <label>
        Type
        <select name="kind" defaultValue={post?.kind || "internship"}>
          <option value="internship">Internship</option>
          <option value="job">Job</option>
        </select>
      </label>
      <label>
        Company
        <input
          name="company"
          required
          minLength={2}
          maxLength={120}
          defaultValue={post?.company}
        />
      </label>
      <label>
        Location
        <input
          name="location"
          maxLength={120}
          defaultValue={post?.location}
          placeholder="Bhopal"
        />
      </label>
      <label>
        Work mode
        <select name="mode" defaultValue={post?.mode || "onsite"}>
          <option value="onsite">On-site</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
        </select>
      </label>
      <label>
        Stipend / salary
        <input
          name="pay"
          maxLength={80}
          defaultValue={post?.pay}
          placeholder="₹10,000 / month"
        />
      </label>
      <label>
        Duration
        <input
          name="duration"
          maxLength={80}
          defaultValue={post?.duration}
          placeholder="3 months"
        />
      </label>
      <label>
        Last date to apply
        <input
          name="deadline"
          type="date"
          defaultValue={post?.deadline?.slice(0, 10)}
        />
      </label>
      <label className="wide">
        Who can apply
        <input
          name="eligibility"
          maxLength={400}
          defaultValue={post?.eligibility}
          placeholder="B.Tech CSE/IT, 2026 or 2027 pass-outs"
        />
      </label>
      <label className="wide">
        Description · role, skills, selection process
        <textarea
          name="description"
          required
          minLength={20}
          maxLength={8000}
          rows={8}
          defaultValue={post?.description}
        />
      </label>
      <label className="wide">
        External apply link (optional; leave empty to use our form)
        <input
          name="externalUrl"
          type="url"
          maxLength={500}
          defaultValue={post?.externalUrl}
        />
      </label>
      <label className="wide inline-check">
        <input
          type="checkbox"
          name="active"
          defaultChecked={post?.active ?? true}
        />
        <span>Show on the site</span>
      </label>
      <div className="wide row-actions">
        <button className="button" disabled={busy}>
          {post ? "Save changes" : "Post opening"}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Applications({ post }: { post: AdminPost }) {
  const query = useQuery({
    queryKey: ["applications", post._id],
    queryFn: async () =>
      (await api.get(`/admin/careers/${post._id}/applications`)).data
        .data as Application[],
  });
  return (
    <div className="card table-scroll">
      <div className="row-actions" style={{ padding: 12 }}>
        <strong>{query.data?.length ?? "…"} applications</strong>
        <button
          disabled={!query.data?.length}
          onClick={() => downloadCsv(post, query.data || [])}
        >
          <Download size={15} /> Download CSV
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>APPLICANT</th>
            <th>DETAILS</th>
            <th>NOTE</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {query.data?.map((a) => (
            <tr key={a._id}>
              <td>
                {a.name}
                <br />
                <small className="muted">
                  {a.email} · {a.phone}
                </small>
              </td>
              <td>
                <small>
                  {[
                    a.branch,
                    a.semester && `Sem ${a.semester}`,
                    a.graduationYear && `Passing ${a.graduationYear}`,
                    a.college,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <br />
                <a
                  href={a.resumeUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  Résumé <ExternalLink size={12} />
                </a>
                <br />
                <small className="muted">
                  {new Date(a.createdAt).toLocaleString()}
                </small>
              </td>
              <td style={{ whiteSpace: "pre-wrap", maxWidth: 320 }}>
                <small>{a.note}</small>
              </td>
              <td>
                <select
                  defaultValue={a.status}
                  aria-label={`Status for ${a.name}`}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/admin/careers/applications/${a._id}`, {
                        status: e.target.value,
                      });
                      toast("Status saved.", "success");
                    } catch (error) {
                      toast(errorMessage(error), "error");
                    }
                  }}
                >
                  <option value="new">New</option>
                  <option value="shortlisted">Shortlisted</option>
                  <option value="rejected">Rejected</option>
                  <option value="hired">Hired</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {query.data && !query.data.length && (
        <p className="notice">No applications yet.</p>
      )}
    </div>
  );
}

export default function Careers() {
  const [editing, setEditing] = useState<AdminPost | "new" | null>(null),
    [viewing, setViewing] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["admin-careers"],
    queryFn: async () =>
      (await api.get("/admin/careers")).data.data as AdminPost[],
  });
  const done = () => {
    setEditing(null);
    void query.refetch();
  };
  return (
    <>
      <div className="row-actions" style={{ justifyContent: "space-between" }}>
        <h2>Jobs &amp; internships</h2>
        {!editing && (
          <button className="button" onClick={() => setEditing("new")}>
            <Plus size={16} /> New opening
          </button>
        )}
      </div>
      {editing && (
        <PostForm
          key={editing === "new" ? "new" : editing._id}
          post={editing === "new" ? undefined : editing}
          onDone={done}
        />
      )}
      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>OPENING</th>
              <th>STATE</th>
              <th>APPLICATIONS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.map((post) => (
              <tr key={post._id}>
                <td>
                  {post.title}
                  <br />
                  <small className="muted">
                    {post.kind === "job" ? "Job" : "Internship"} ·{" "}
                    {post.company}
                    {post.deadline &&
                      ` · until ${new Date(post.deadline).toLocaleDateString()}`}
                  </small>
                </td>
                <td>{post.active ? "Live" : "Hidden"}</td>
                <td>
                  {post.externalUrl ? "External link" : post.applications}
                </td>
                <td>
                  <div className="row-actions">
                    <a
                      href={`/jobs/${post.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                    <button onClick={() => setEditing(post)}>Edit</button>
                    {!post.externalUrl && (
                      <button
                        onClick={() =>
                          setViewing(viewing === post._id ? null : post._id)
                        }
                      >
                        {viewing === post._id ? "Hide" : "Applications"}
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        if (
                          !(await confirmDialog({
                            title: `Delete “${post.title}”?`,
                            body: "The opening and all its applications are removed for good. To just stop applications, edit it and untick “Show on the site”.",
                            confirmLabel: "Delete",
                          }))
                        )
                          return;
                        try {
                          await api.delete(`/admin/careers/${post._id}`);
                          toast("Opening deleted.", "success");
                          void query.refetch();
                        } catch (e) {
                          toast(errorMessage(e), "error");
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {query.data && !query.data.length && (
          <p className="notice">No openings yet. Post the first one.</p>
        )}
      </div>
      {viewing && query.data?.find((p) => p._id === viewing) && (
        <Applications post={query.data.find((p) => p._id === viewing)!} />
      )}
    </>
  );
}
