import { Link } from "react-router-dom";
import { ArrowUpRight, Download, SearchX, ArrowRight, Eye } from "lucide-react";
import { lazy, Suspense, useState, type CSSProperties } from "react";
import { branchIdentity } from "../lib/branches";
import { downloadResource } from "../lib/download";
import { wake } from "../lib/wake";
import { errorMessage } from "../lib/api";
const QuickPreview = lazy(() => import("./QuickPreview"));
import type { ContentItem } from "../lib/types";
import { contentPath } from "../lib/types";
import { PdfThumbnail } from "./PdfThumbnail";
export function Skeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="content-grid" aria-label="Loading library" role="status">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton card" key={i} aria-hidden="true">
          <div className="skeleton-paper" />
          <div className="skeleton-line short" />
          <div className="skeleton-line" />
          <div className="skeleton-line medium" />
        </div>
      ))}
    </div>
  );
}
export function ErrorState({
  retry,
  message = "The archive is taking a moment. Please try again.",
}: {
  retry: () => void;
  message?: string;
}) {
  return (
    <div className="error-state card" role="alert">
      <SearchX size={28} />
      <div>
        <h3>Let’s try that again.</h3>
        <p>{message}</p>
      </div>
      <button className="button secondary" onClick={retry}>
        Try again <ArrowRight size={16} />
      </button>
    </div>
  );
}
export function Empty({
  title = "The next resource could come from you",
  message = "There are no published resources for these filters yet.",
  actionLabel = "Request a paper",
  actionTo = "/contact?request=true",
}: {
  title?: string;
  message?: string;
  actionLabel?: string;
  actionTo?: string;
}) {
  return (
    <div className="empty card">
      <SearchX size={32} />
      <h3>{title}</h3>
      <p>{message}</p>
      <Link className="button secondary" to={actionTo}>
        {actionLabel} <ArrowRight size={16} />
      </Link>
    </div>
  );
}
export function ContentCard({
  item,
  kind = "papers",
  saved = false,
}: {
  item: ContentItem;
  kind?: string;
  saved?: boolean;
}) {
  const offering = item.offerings[0],
    subject = offering?.subject,
    identity = branchIdentity(offering?.branch.code),
    exam =
      kind === "notes"
        ? item.unit || item.format?.toUpperCase() || "NOTE"
        : item.examType && item.examType !== "Unknown"
          ? item.examType
          : "";
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function download() {
    if (busy || saved) return;
    setBusy(true);
    setMessage("");
    try {
      await downloadResource(item._id, kind);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className={`resource card ${kind === "notes" ? "note-resource" : ""}`}
      style={{ "--branch": identity.color } as CSSProperties}
      data-tilt
      onPointerEnter={() => wake()}
      onFocus={() => wake()}
    >
      <Link className="resource-main" to={contentPath(item, kind)}>
        <div className="card-top">
          <PdfThumbnail
            key={`${kind}/${item._id}/${item.updatedAt || ""}/${item.hasThumbnail}`}
            id={item._id}
            kind={kind}
            available={item.hasThumbnail}
            thumbKey={item.thumbKey}
            cover
            fallback={
              <span className="cover-art">
                <identity.Icon size={22} />
                <strong>
                  {subject?.code || (kind === "notes" ? "NOTE" : "PAPER")}
                </strong>
                <small>
                  {[offering?.semester.name, kind === "notes" ? "" : item.year]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
            }
          />
          <span className="pill">
            {kind === "notes" ? "SHORT NOTE" : item.year || "YEAR UNKNOWN"}
          </span>
          <ArrowUpRight className="muted" size={18} />
        </div>
        <div className="eyebrow">{subject?.code || "ARCHIVE"}</div>
        {item.featured && <span className="eyebrow">Featured resource</span>}
        <h3>{kind === "notes" ? item.title : subject?.name || item.title}</h3>
        <ul className="card-tags" aria-label="Details">
          <li className="branch-tag">
            {offering?.branch.code || offering?.branch.name || "Subject review"}
          </li>
          <li>{offering?.semester.name || "Semester review"}</li>
          {kind !== "notes" && item.year && <li>{item.year}</li>}
          {exam && <li className="exam-tag">{exam}</li>}
        </ul>
      </Link>
      <div className="card-bottom">
        <span>{kind === "notes" || exam ? "" : "Exam type unverified"}</span>
        <span aria-label={`${item.downloads} downloads`}>
          <Download size={13} />
          {item.downloads.toLocaleString()}
        </span>
      </div>
      <div className="resource-actions">
        {item.format === "markdown" ? (
          <Link className="text-link" to={contentPath(item, kind)}>
            Read note <ArrowUpRight size={16} />
          </Link>
        ) : (
          <>
            <button
              type="button"
              disabled={saved}
              aria-label="Quick preview"
              onClick={() => setPreview(true)}
            >
              <Eye size={16} />
              Preview
            </button>
            <button
              type="button"
              disabled={busy || saved}
              aria-label="Quick download"
              onClick={download}
            >
              <Download size={16} />
              {busy ? "Preparing…" : "Download"}
            </button>
          </>
        )}
      </div>
      {message && (
        <p className="card-error" role="alert">
          {message}
        </p>
      )}
      {preview && (
        <Suspense
          fallback={
            <p role="status" className="card-error">
              Opening preview…
            </p>
          }
        >
          <QuickPreview
            item={item}
            kind={kind}
            onClose={() => setPreview(false)}
          />
        </Suspense>
      )}
    </article>
  );
}
export function SavedNotice() {
  return (
    <div className="notice" role="status">
      Waking up the server… You’re viewing a saved library. Downloads and
      submissions will return when the server connects.
    </div>
  );
}
