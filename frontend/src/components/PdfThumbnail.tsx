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
  thumbKey,
}: {
  id: string;
  kind?: string;
  available?: boolean;
  large?: boolean;
  /** Fill the parent (cards): first page cropped from the top, fallback art underneath. */
  cover?: boolean;
  fallback?: ReactNode;
  /** Storage key: served from the CDN first, the API is the fallback. */
  thumbKey?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [viaApi, setViaApi] = useState(!thumbKey);
  const src = viaApi
    ? apiUrl(`/${kind}/${id}/thumbnail`)
    : `/files/${thumbKey}`;
  const onError = () => (viaApi ? setFailed(true) : setViaApi(true));
  const [loaded, setLoaded] = useState(false);
  if (cover)
    return (
      <span className="pdf-cover" aria-hidden="true">
        {/* The fallback art doubles as the placeholder while the image fades in. */}
        {fallback}
        {available && !failed && (
          <img
            className={loaded ? "loaded" : ""}
            src={src}
            alt=""
            width={480}
            height={300}
            loading="lazy"
            decoding="async"
            crossOrigin={viaApi ? "use-credentials" : undefined}
            onError={onError}
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
        src={src}
        alt=""
        width={480}
        height={480}
        loading="lazy"
        decoding="async"
        crossOrigin={viaApi ? "use-credentials" : undefined}
        onError={onError}
        onLoad={() => setLoaded(true)}
      />
    </span>
  );
}
