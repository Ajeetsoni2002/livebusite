import { useEffect, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { apiUrl } from "../lib/api";

// Without the Pages R2 binding every /files request 404s. After the first miss, go
// straight to the API for the rest of the visit instead of failing once per image.
let cdnMissing = false;

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
  const [viaApi, setViaApi] = useState(!thumbKey || cdnMissing);
  // The free API may still be waking up: retry it once before showing the fallback.
  const [retry, setRetry] = useState(0);
  const src = viaApi
    ? apiUrl(`/${kind}/${id}/thumbnail${retry ? `?retry=${retry}` : ""}`)
    : `/files/${thumbKey}`;
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setWaiting(false);
      setFailed(false);
      setRetry(1);
    }, 15_000);
    return () => clearTimeout(timer);
  }, [waiting]);
  const onError = () => {
    if (!viaApi) {
      cdnMissing = true;
      setViaApi(true);
    } else {
      setFailed(true);
      if (!retry) setWaiting(true);
    }
  };
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
