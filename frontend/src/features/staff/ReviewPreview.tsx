import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { X } from "lucide-react";
import { apiUrl } from "../../lib/api";
import { usePublic } from "../../lib/queries";
import type { ContentItem, Offering } from "../../lib/types";
import { offeringLabel } from "./OfferingPicker";

// Staff review: read the uploaded PDF (pending ones too) and decide without leaving the list.
export default function ReviewPreview({
  item,
  kind,
  onClose,
  onAction,
}: {
  item: ContentItem;
  kind: string;
  onClose: () => void;
  onAction?: (name: "approve" | "reject") => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    all = usePublic<Offering[]>("/offerings");
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node?.showModal();
    return () => {
      node?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  const known = all.data?.data || [];
  const subjects = (item.offerings || [])
    .map((o) =>
      typeof o === "string"
        ? known.find((k) => k._id === o)
        : o.subject
          ? o
          : undefined,
    )
    .filter(Boolean) as Offering[];
  const src = apiUrl(`/${kind}/${item._id}/preview`);
  return (
    <dialog
      ref={dialog}
      className="quick-preview review-preview"
      aria-label={`Review: ${item.title}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="quick-preview-shell">
        <div className="quick-preview-heading">
          <div>
            <span className="eyebrow">
              {kind === "notes" ? "SHORT NOTE" : "QUESTION PAPER"} /{" "}
              {item.status?.toUpperCase()}
            </span>
            <h2>{item.title}</h2>
            <p className="review-meta">
              {item.author?.name || "Legacy archive"}
              {item.year ? ` · ${item.year}` : ""}
              {item.examType && item.examType !== "Unknown"
                ? ` · ${item.examType}`
                : ""}
              {item.unit ? ` · ${item.unit}` : ""}
            </p>
            {subjects.length > 0 && (
              <div className="offering-chips">
                {subjects.map((o) => (
                  <span key={o._id} className="offering-chip">
                    {offeringLabel(o)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="Close preview"
            onClick={onClose}
            autoFocus
          >
            <X size={20} />
          </button>
        </div>
        {item.format === "markdown" ? (
          <div className="review-markdown markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
            >
              {item.markdown || ""}
            </ReactMarkdown>
          </div>
        ) : (
          <iframe src={src} title={`PDF preview: ${item.title}`} />
        )}
        <div className="quick-preview-footer">
          {item.format !== "markdown" ? (
            <span>
              Preview not showing?{" "}
              <a href={src} target="_blank" rel="noopener noreferrer">
                Open in a new tab
              </a>
            </span>
          ) : (
            <span />
          )}
          {onAction && (
            <div className="row-actions">
              <button onClick={() => onAction("approve")}>Approve</button>
              <button onClick={() => onAction("reject")}>Reject</button>
              <button onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
