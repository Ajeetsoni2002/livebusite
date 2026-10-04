import { useState } from "react";
import { FileText } from "lucide-react";
import { apiUrl } from "../lib/api";

export function PdfThumbnail({
  id,
  kind = "papers",
  available = false,
  large = false,
}: {
  id: string;
  kind?: string;
  available?: boolean;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
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
