import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, ScanSearch, Trash2 } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import type { ContentItem } from "../../lib/types";
import { confirmDialog, toast } from "../../components/Feedback";
import ReviewPreview from "./ReviewPreview";

type Pair = {
  kind: "papers" | "notes";
  score: number;
  similarity: number;
  basis: "text" | "pages" | "none";
  a: ContentItem;
  b: ContentItem;
};
type Report = {
  pairs: Pair[];
  unscanned: { papers: number; notes: number };
  threshold: number;
};

/**
 * Pairs of live papers or notes whose content overlaps, from the fingerprints the
 * upload check and the background job store. The admin reads both and deletes one.
 */
export default function Duplicates() {
  const client = useQueryClient();
  const [min, setMin] = useState("0.8");
  const [preview, setPreview] = useState<{
    item: ContentItem;
    kind: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const report = useQuery({
    queryKey: ["duplicates", min],
    queryFn: async () =>
      // Comparing every pair takes the small API instance a while the first time.
      (
        await api.get("/admin/duplicates", {
          params: { min },
          timeout: 180_000,
        })
      ).data.data as Report,
  });
  const unscanned =
    (report.data?.unscanned.papers || 0) + (report.data?.unscanned.notes || 0);
  async function scan() {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/duplicates/scan", {});
      toast(
        data.data.queued
          ? `Fingerprinting ${data.data.queued} item(s) in the background. Refresh in a few minutes.`
          : "Every item already has a fingerprint.",
        "success",
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove(pair: Pair, item: ContentItem) {
    const other = item._id === pair.a._id ? pair.b : pair.a;
    if (
      !(await confirmDialog({
        title: `Delete “${item.title}”?`,
        body: `“${other.title}” stays. The deleted copy can be restored from the ${pair.kind} list with “Include deleted”.`,
        confirmLabel: "Delete this copy",
        danger: true,
      }))
    )
      return;
    try {
      await api.post(`/admin/${pair.kind}/${item._id}/delete`);
      toast("Deleted. One copy remains.", "success");
      await client.invalidateQueries({ queryKey: ["duplicates"] });
      await client.invalidateQueries({ queryKey: ["staff-content"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  const side = (pair: Pair, item: ContentItem) => (
    <td data-label={item === pair.a ? "Copy A" : "Copy B"}>
      <strong>{item.title}</strong>
      <p className="muted">
        <span className={`status ${item.status}`}>{item.status}</span>
        {item.year ? ` · ${item.year}` : ""}
        {item.examType && item.examType !== "Unknown"
          ? ` · ${item.examType}`
          : ""}
        {` · ${item.downloads || 0} downloads`}
        {` · ${item.author?.name || "Legacy archive"}`}
        {item.createdAt
          ? ` · ${new Date(item.createdAt).toLocaleDateString("en-IN")}`
          : ""}
      </p>
      <div className="row-actions">
        <button onClick={() => setPreview({ item, kind: pair.kind })}>
          <Eye size={15} /> Preview
        </button>
        <button className="danger-text" onClick={() => remove(pair, item)}>
          <Trash2 size={15} /> Delete this copy
        </button>
      </div>
    </td>
  );
  return (
    <>
      <div className="section-head">
        <h2>Duplicate content</h2>
        <button className="button secondary" disabled={busy} onClick={scan}>
          <ScanSearch size={16} /> Fingerprint unscanned items
        </button>
      </div>
      <p className="muted">
        Every upload is compared with the library before it is accepted. This
        list shows live items whose content still overlaps, so one of each pair
        can be removed. Deleting is reversible.
        {report.data &&
          (unscanned
            ? ` ${unscanned} item(s) have no fingerprint yet and are not compared; fingerprint them to include them.`
            : " Every item has a fingerprint.")}
      </p>
      <div className="toolbar">
        <label>
          Show pairs sharing at least
          <select
            aria-label="Minimum shared content"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          >
            <option value="0.8">80% (duplicates)</option>
            <option value="0.5">50% (possible duplicates)</option>
            <option value="0.3">30% (loosely related)</option>
          </select>
        </label>
      </div>
      {report.isError && (
        <p className="notice error">
          {errorMessage(report.error)}{" "}
          <button onClick={() => report.refetch()}>Try again</button>
        </p>
      )}
      <div className="card table-scroll">
        <table className="data-table responsive-table">
          <thead>
            <tr>
              <th>MATCH</th>
              <th>COPY A</th>
              <th>COPY B</th>
            </tr>
          </thead>
          <tbody>
            {report.isPending &&
              Array.from({ length: 3 }, (_, i) => (
                <tr key={i} aria-hidden="true">
                  <td colSpan={3}>
                    <div className="skeleton-line" />
                  </td>
                </tr>
              ))}
            {report.data?.pairs.map((pair) => (
              <tr key={`${pair.a._id}-${pair.b._id}`}>
                <td data-label="Match">
                  <strong>{pair.similarity}%</strong>
                  <p className="muted">
                    {pair.kind === "notes" ? "Notes" : "Papers"} ·{" "}
                    {pair.basis === "text"
                      ? "same text"
                      : "same pages (scanned)"}
                  </p>
                </td>
                {side(pair, pair.a)}
                {side(pair, pair.b)}
              </tr>
            ))}
          </tbody>
        </table>
        {report.data && !report.data.pairs.length && (
          <p className="staff-card muted">
            No two items share this much content. The library is clean.
          </p>
        )}
      </div>
      {preview && (
        <ReviewPreview
          item={preview.item}
          kind={preview.kind}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
