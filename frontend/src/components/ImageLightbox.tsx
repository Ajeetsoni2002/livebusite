import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * A modal that shows one image large, e.g. a payment QR code to scan from the screen.
 * Closes on Escape, the close button or a click on the backdrop.
 */
export default function ImageLightbox({
  title,
  src,
  alt,
  loading,
  error,
  children,
  onClose,
}: {
  title: string;
  src?: string | null;
  alt: string;
  loading?: boolean;
  error?: string | null;
  /** Shown under the title, e.g. how to pay. */
  children?: ReactNode;
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
      className="image-lightbox"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="image-lightbox-shell">
        <div className="image-lightbox-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
            autoFocus
          >
            <X size={18} />
          </button>
        </div>
        {children}
        {loading ? (
          <p role="status" className="muted small">
            Loading the image…
          </p>
        ) : src ? (
          <img src={src} alt={alt} />
        ) : (
          <p className="notice error">
            {error || "The image is not available."}
          </p>
        )}
      </div>
    </dialog>
  );
}
