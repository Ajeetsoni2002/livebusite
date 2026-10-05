import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import type { ContentItem } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";
import { useUser } from "./Auth";
import ReviewPreview from "./ReviewPreview";
export default function Content({
  kind = "papers",
  moderation = false,
}: {
  kind?: string;
  moderation?: boolean;
}) {
  const user = useUser(),
    client = useQueryClient(),
    navigate = useNavigate(),
    [filter, setFilter] = useState(""),
    [deleted, setDeleted] = useState(false),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState(""),
    [reviewing, setReviewing] = useState<
      (ContentItem & { _kind?: string }) | null
    >(null);
  const [queryText, setQueryText] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQueryText(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: [
      "staff-content",
      user.role,
      kind,
      filter,
      deleted,
      page,
      moderation,
      queryText,
    ],
    queryFn: async () => {
      if (moderation) return (await api.get("/admin/moderation")).data;
      return (
        await api.get(`/${user.role}/${kind}`, {
          params: {
            status: filter || undefined,
            deleted,
            page,
            q: queryText || undefined,
          },
        })
      ).data;
    },
  });
  const items: ContentItem[] = moderation
    ? [
        ...(query.data?.data.papers || []).map((p: ContentItem) => ({
          ...p,
          _kind: "papers",
        })),
        ...(query.data?.data.notes || []).map((p: ContentItem) => ({
          ...p,
          _kind: "notes",
        })),
      ]
    : query.data?.data || [];
  async function action(item: ContentItem, name: string, itemKind = kind) {
    try {
      let body = {};
      if (name === "reject") {
        const reason = prompt("Reason for rejection");
        if (!reason) return false;
        body = { reason };
      }
      if (
        name === "delete" &&
        !confirm(`Soft-delete “${item.title}”? You can restore it.`)
      )
        return false;
      await api.post(`/admin/${itemKind}/${item._id}/${name}`, body);
      await client.invalidateQueries({ queryKey: ["staff-content"] });
      setMessage("Saved.");
      return true;
    } catch (e) {
      setMessage(errorMessage(e));
      return false;
    }
  }
  return (
    <>
      <div className="section-head">
        <h2>
          {moderation
            ? "Moderation queue"
            : user.role === "contributor"
              ? "My contributions"
              : kind === "papers"
                ? "Question papers"
                : "Short notes"}
        </h2>
        <Link className="button secondary" to={`/${user.role}/upload`}>
          Upload
        </Link>
      </div>
      <div className="toolbar">
        <input
          placeholder="Search uploads"
          aria-label="Search uploads"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!moderation && (
          <>
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              {["draft", "pending", "published", "rejected"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {user.role === "admin" && (
              <label>
                <span>Include deleted</span>
                <input
                  type="checkbox"
                  checked={deleted}
                  onChange={(e) => setDeleted(e.target.checked)}
                />
              </label>
            )}
          </>
        )}
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {query.isError && (
        <p className="notice error">{errorMessage(query.error)}</p>
      )}
      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>RESOURCE</th>
              <th>STATUS</th>
              <th>CONTRIBUTOR / YEAR</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {items
              .filter(
                (item) =>
                  !moderation ||
                  item.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((item: ContentItem & { _kind?: string }) => (
                <tr key={item._id}>
                  <td>
                    <strong>{item.title}</strong>
                    {item.metadataNeedsReview && (
                      <p className="notice">
                        Metadata review required.{" "}
                        {item.provenance?.conflicts?.join("; ")}
                      </p>
                    )}
                    {item.rejectionReason && <p>{item.rejectionReason}</p>}
                    {item.deletedAt && (
                      <span className="badge">Soft-deleted</span>
                    )}
                  </td>
                  <td>
                    <span className={`status ${item.status}`}>
                      {item.status}
                    </span>
                  </td>
                  <td>
                    {item.author?.name || "Legacy archive"}
                    <br />
                    {item.year || "—"}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => setReviewing(item)}>
                        Preview
                      </button>
                      <button
                        onClick={() =>
                          navigate(
                            `/${user.role}/upload?kind=${item._kind || kind}&edit=${item._id}`,
                          )
                        }
                      >
                        Edit / inspect
                      </button>
                      {user.role === "admin" && (
                        <>
                          <button
                            onClick={() =>
                              action(item, "approve", item._kind || kind)
                            }
                          >
                            Approve
                          </button>
                          <button
                            onClick={() =>
                              action(item, "reject", item._kind || kind)
                            }
                          >
                            Reject
                          </button>
                          <button
                            onClick={() =>
                              action(
                                item,
                                item.deletedAt ? "restore" : "delete",
                                item._kind || kind,
                              )
                            }
                          >
                            {item.deletedAt ? "Restore" : "Delete"}
                          </button>
                          <button
                            onClick={() =>
                              action(item, "feature", item._kind || kind)
                            }
                          >
                            Feature
                          </button>
                          <button
                            onClick={() =>
                              action(item, "unfeature", item._kind || kind)
                            }
                          >
                            Unfeature
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!query.isPending && !items.length && (
          <p className="staff-card muted">No uploads in this view.</p>
        )}
      </div>
      {reviewing && (
        <ReviewPreview
          item={reviewing}
          kind={reviewing._kind || kind}
          onClose={() => setReviewing(null)}
          onAction={
            user.role === "admin"
              ? async (name) => {
                  if (await action(reviewing, name, reviewing._kind || kind))
                    setReviewing(null);
                }
              : undefined
          }
        />
      )}
      {!moderation && query.data?.meta?.pages > 1 && (
        <div className="pagination">
          <button
            disabled={page === 1}
            className="button secondary"
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            {page} / {query.data.meta.pages}
          </span>
          <button
            disabled={page >= query.data.meta.pages}
            className="button secondary"
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
