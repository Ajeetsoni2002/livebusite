import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X, ArrowUpRight } from "lucide-react";
import { errorMessage } from "../lib/api";
import { downloadResource } from "../lib/download";
const PdfViewer = lazy(() => import("./PdfViewer"));
import { contentPath, type ContentItem } from "../lib/types";

export default function QuickPreview({
  item,
  kind,
  onClose,
}: {
  item: ContentItem;
  kind: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
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
  return (
    <dialog
      ref={dialog}
      className="quick-preview"
      aria-label={`Preview: ${item.title}`}
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
              QUICK LOOK / {item.year || "SHORT NOTE"}
            </span>
            <h2>{item.offerings[0]?.subject.name || item.title}</h2>
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
        <Suspense
          fallback={
            <div className="pdf-viewer">
              <div className="pdf-state" role="status">
                <strong>Loading preview…</strong>
              </div>
            </div>
          }
        >
          <PdfViewer
            kind={kind}
            id={item._id}
            title={item.title}
            onDownload={() =>
              downloadResource(item._id, kind).catch((error) =>
                setMessage(errorMessage(error)),
              )
            }
          />
        </Suspense>
        <div className="quick-preview-footer">
          <span role="status">{message}</span>
          <Link
            className="text-link"
            to={contentPath(item, kind)}
            onClick={onClose}
          >
            Full details <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
    </dialog>
  );
}
