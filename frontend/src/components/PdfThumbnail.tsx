import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { apiUrl } from "../lib/api";

export function PdfThumbnail({
  id,
  kind = "papers",
  available = false,
  large = false,
  cover = false,
  fallback,
}: {
  id: string;
  kind?: string;
  available?: boolean;
  large?: boolean;
  /** Fill the parent (cards): first page cropped from the top, fallback art underneath. */
  cover?: boolean;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (cover)
    return (
      <span className="pdf-cover" aria-hidden="true">
        {/* The fallback art doubles as the placeholder while the image fades in. */}
        {fallback}
        {available && !failed && (
          <img
            className={loaded ? "loaded" : ""}
            src={apiUrl(`/${kind}/${id}/thumbnail`)}
            alt=""
            width={480}
            height={300}
            loading="lazy"
            decoding="async"
            crossOrigin="use-credentials"
            onError={() => setFailed(true)}
            onLoad={() => setLoaded(true)}
          />
        )}
      </span>
    );
  if (!available || failed)
    return (
      <span
        className={`file-icon ${kind === "notes" ? "violet" : ""} ${large ? "file-icon-large" : ""}`}
        aria-hidden="true"
      >
        <FileText size={large ? 54 : 21} />
      </span>
    );
  return (
    <span
      className={`pdf-thumbnail ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      <img
        className={loaded ? "loaded" : ""}
        src={apiUrl(`/${kind}/${id}/thumbnail`)}
        alt=""
        width={480}
        height={480}
        loading="lazy"
        decoding="async"
        crossOrigin="use-credentials"
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
      />
    </span>
  );
}
