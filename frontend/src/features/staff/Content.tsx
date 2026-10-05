import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Eye,
  MoreHorizontal,
  Pencil,
  X,
} from "lucide-react";
import type { ContentItem } from "../../lib/types";
import { api, errorMessage } from "../../lib/api";
import { useUser } from "./Auth";
import ReviewPreview from "./ReviewPreview";
import { confirmDialog, promptDialog, toast } from "../../components/Feedback";

type Row = ContentItem & { _kind?: string };
type SortKey = "title" | "status" | "contributor" | "year";
const statusOrder = ["pending", "draft", "rejected", "published"];

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
    [params, setParams] = useSearchParams(),
    [filter, setFilter] = useState(""),
    [deleted, setDeleted] = useState(false),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(() => params.get("q") || ""),
    [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [reviewing, setReviewing] = useState<Row | null>(null);
  const admin = user.role === "admin";
  const [queryText, setQueryText] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQueryText(search);
      setPage(1);
      const next = new URLSearchParams(params);
      if (search) next.set("q", search);
      else next.delete("q");
      if (next.toString() !== params.toString())
        setParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setSearch(params.get("q") || ""), [params]);
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
  const loaded: Row[] = moderation
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
  const items = useMemo(() => {
    const visible = loaded.filter(
      (item) =>
        !moderation || item.title.toLowerCase().includes(search.toLowerCase()),
    );
    if (!sort) return visible;
    const value = (item: Row): string | number =>
      sort.key === "title"
        ? item.title.toLowerCase()
        : sort.key === "status"
          ? statusOrder.indexOf(item.status || "")
          : sort.key === "year"
            ? item.year || 0
            : (item.author?.name || "").toLowerCase();
    return [...visible].sort((a, b) => {
      const x = value(a),
        y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [loaded, moderation, search, sort]);
  useEffect(() => setSelected(new Set()), [query.data]);

  async function post(item: Row, name: string, body = {}) {
    await api.post(`/admin/${item._kind || kind}/${item._id}/${name}`, body);
  }
  async function action(item: Row, name: string) {
    try {
      let body = {};
      if (name === "reject") {
        const reason = await promptDialog({
          title: `Reject “${item.title}”?`,
          body: "The contributor sees this reason.",
          confirmLabel: "Reject",
          danger: true,
          input: { label: "Reason for rejection", minLength: 3 },
        });
        if (!reason) return false;
        body = { reason };
      }
      if (
        name === "delete" &&
        !(await confirmDialog({
          title: `Delete “${item.title}”?`,
          body: "It is soft-deleted and can be restored later.",
          confirmLabel: "Delete",
          danger: true,
        }))
      )
        return false;
      await post(item, name, body);
      await client.invalidateQueries({ queryKey: ["staff-content"] });
      toast(
        {
          approve: "Approved and published.",
          reject: "Rejected.",
          delete: "Deleted. You can restore it from “Include deleted”.",
          restore: "Restored.",
          feature: "Featured on the home page.",
          unfeature: "Removed from featured.",
        }[name] || "Saved.",
        "success",
      );
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    }
  }
  async function bulk(name: "approve" | "reject" | "delete") {
    const targets = items.filter((item) => selected.has(item._id));
    if (!targets.length) return;
    let body = {};
    if (name === "reject") {
      const reason = await promptDialog({
        title: `Reject ${targets.length} uploads?`,
        body: "The same reason is sent to every contributor.",
        confirmLabel: "Reject all",
        danger: true,
        input: { label: "Reason for rejection", minLength: 3 },
      });
      if (!reason) return;
      body = { reason };
    } else if (
      !(await confirmDialog({
        title: `${name === "approve" ? "Approve and publish" : "Delete"} ${targets.length} uploads?`,
        confirmLabel: name === "approve" ? "Approve all" : "Delete all",
        danger: name === "delete",
      }))
    )
      return;
    setBusy(true);
    // No bulk endpoint exists: send one request per item and report partial failures.
    const results = await Promise.allSettled(
      targets.map((item) => post(item, name, body)),
    );
    setBusy(false);
    await client.invalidateQueries({ queryKey: ["staff-content"] });
    const failed = results
      .map((r, i) =>
        r.status === "rejected"
          ? `${targets[i].title}: ${errorMessage(r.reason)}`
          : "",
      )
      .filter(Boolean);
    toast(
      [
        `${targets.length - failed.length} of ${targets.length} done.`,
        ...failed,
      ].join("\n"),
      failed.length ? "error" : "success",
    );
  }
  const header = (key: SortKey, label: string) => {
    const active = sort?.key === key;
    return (
      <th
        aria-sort={
          active ? (sort.dir === 1 ? "ascending" : "descending") : "none"
        }
      >
        <button
          className="sort-header"
          onClick={() =>
            setSort(
              active && sort.dir === -1 ? null : { key, dir: active ? -1 : 1 },
            )
          }
        >
          {label}
          {active ? (
            sort.dir === 1 ? (
              <ArrowUp size={13} />
            ) : (
              <ArrowDown size={13} />
            )
          ) : (
            <ArrowUpDown size={13} />
          )}
        </button>
      </th>
    );
  };
  const allSelected =
    items.length > 0 && items.every((i) => selected.has(i._id));
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
          type="search"
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
            {admin && (
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={deleted}
                  onChange={(e) => setDeleted(e.target.checked)}
                />
                <span>Include deleted</span>
              </label>
            )}
          </>
        )}
      </div>
      {admin && selected.size > 0 && (
        <div className="bulk-bar card" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <div className="row-actions">
            <button disabled={busy} onClick={() => bulk("approve")}>
              <Check size={15} /> Approve
            </button>
            <button disabled={busy} onClick={() => bulk("reject")}>
              <X size={15} /> Reject
            </button>
            <button
              disabled={busy}
              className="danger-text"
              onClick={() => bulk("delete")}
            >
              Delete
            </button>
            <button onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}
      {query.isError && (
        <p className="notice error">
          {errorMessage(query.error)}{" "}
          <button onClick={() => query.refetch()}>Try again</button>
        </p>
      )}
      <div className="card table-scroll">
        <table className="data-table responsive-table">
          <thead>
            <tr>
              {admin && (
                <th className="select-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(
                        allSelected
                          ? new Set()
                          : new Set(items.map((i) => i._id)),
                      )
                    }
                  />
                </th>
              )}
              {header("title", "RESOURCE")}
              {header("status", "STATUS")}
              {header("contributor", "CONTRIBUTOR")}
              {header("year", "YEAR")}
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {query.isPending &&
              Array.from({ length: 4 }, (_, i) => (
                <tr key={i} aria-hidden="true">
                  <td colSpan={admin ? 6 : 5}>
                    <div className="skeleton-line" />
                  </td>
                </tr>
              ))}
            {items.map((item) => (
              <tr
                key={item._id}
                className={selected.has(item._id) ? "is-selected" : ""}
              >
                {admin && (
                  <td className="select-cell">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.title}`}
                      checked={selected.has(item._id)}
                      onChange={() =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (next.has(item._id)) next.delete(item._id);
                          else next.add(item._id);
                          return next;
                        })
                      }
                    />
                  </td>
                )}
                <td data-label="Resource">
                  <strong>{item.title}</strong>
                  {item.metadataNeedsReview && (
                    <p className="notice">
                      Metadata review required.{" "}
                      {item.provenance?.conflicts?.join("; ")}
                    </p>
                  )}
                  {item.rejectionReason && (
                    <p className="muted">Reason: {item.rejectionReason}</p>
                  )}
                  {item.deletedAt && (
                    <span className="badge">Soft-deleted</span>
                  )}
                  {item.featured && <span className="badge">Featured</span>}
                </td>
                <td data-label="Status">
                  <span className={`status ${item.status}`}>{item.status}</span>
                </td>
                <td data-label="Contributor">
                  {item.author?.name || "Legacy archive"}
                </td>
                <td data-label="Year">{item.year || "—"}</td>
                <td data-label="Actions">
                  <div className="row-actions">
                    <button onClick={() => setReviewing(item)}>
                      <Eye size={15} /> Preview
                    </button>
                    <button
                      onClick={() =>
                        navigate(
                          `/${user.role}/upload?kind=${item._kind || kind}&edit=${item._id}`,
                        )
                      }
                    >
                      <Pencil size={15} /> Edit
                    </button>
                    {admin &&
                      item.status !== "published" &&
                      !item.deletedAt && (
                        <button onClick={() => action(item, "approve")}>
                          <Check size={15} /> Approve
                        </button>
                      )}
                    {admin && item.status === "pending" && (
                      <button onClick={() => action(item, "reject")}>
                        <X size={15} /> Reject
                      </button>
                    )}
                    {admin && (
                      <details className="row-more">
                        <summary aria-label={`More actions for ${item.title}`}>
                          <MoreHorizontal size={16} />
                        </summary>
                        <div className="row-more-menu card">
                          {item.status === "published" && (
                            <button onClick={() => action(item, "reject")}>
                              Unpublish (reject)
                            </button>
                          )}
                          <button
                            onClick={() =>
                              action(
                                item,
                                item.featured ? "unfeature" : "feature",
                              )
                            }
                          >
                            {item.featured ? "Unfeature" : "Feature"}
                          </button>
                          <button
                            className="danger-text"
                            onClick={() =>
                              action(
                                item,
                                item.deletedAt ? "restore" : "delete",
                              )
                            }
                          >
                            {item.deletedAt ? "Restore" : "Delete"}
                          </button>
                        </div>
                      </details>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!query.isPending && !items.length && (
          <p className="staff-card muted">
            {moderation
              ? "Nothing waiting for review. Nice work."
              : "No uploads in this view."}
          </p>
        )}
      </div>
      {reviewing && (
        <ReviewPreview
          item={reviewing}
          kind={reviewing._kind || kind}
          onClose={() => setReviewing(null)}
          onAction={
            admin
              ? async (name) => {
                  if (await action(reviewing, name)) setReviewing(null);
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
