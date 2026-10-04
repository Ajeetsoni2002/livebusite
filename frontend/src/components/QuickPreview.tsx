import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { X, ArrowUpRight } from "lucide-react";
import { apiUrl } from "../lib/api";
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
        <iframe
          src={apiUrl(`/${kind}/${item._id}/preview`)}
          title={`PDF preview: ${item.title}`}
        />
        <div className="quick-preview-footer">
          <span>
            Preview not showing?{" "}
            <a
              href={apiUrl(`/${kind}/${item._id}/preview`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in a new tab
            </a>
          </span>
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
