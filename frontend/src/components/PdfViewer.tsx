import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { apiUrl } from "../lib/api";
import { wake } from "../lib/wake";

GlobalWorkerOptions.workerSrc = workerUrl;

type Phase =
  | { name: "loading" }
  | { name: "waking"; attempt: number }
  | { name: "ready"; doc: PDFDocumentProxy; sizes: [number, number][] }
  | { name: "error"; message: string };

// Seconds to wait between attempts while the free API wakes up (~1.5 min in total).
const backoff = [3, 5, 8, 12, 15, 20, 25];

class Retryable extends Error {}

/** Only ever accepts real PDF bytes; anything else (HTML, JSON errors) never reaches the page. */
async function fetchPdf(kind: string, id: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/${kind}/${id}/preview?stream=1`), {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/pdf" },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Retryable("network");
  }
  const type = response.headers.get("Content-Type") || "";
  if (response.ok && type.includes("application/pdf")) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-")
      return bytes;
    throw new Error("The file is not a readable PDF.");
  }
  await response.body?.cancel();
  if ([502, 503, 504, 429].includes(response.status) || type.includes("html"))
    throw new Retryable(String(response.status));
  throw new Error(
    response.status === 404 || response.status === 403
      ? "This PDF is no longer available."
      : "The preview could not be loaded.",
  );
}

function Page({
  doc,
  number,
  size,
  width,
}: {
  doc: PDFDocumentProxy;
  number: number;
  size: [number, number];
  width: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !width || !canvas.current) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | undefined;
    (async () => {
      const page = await doc.getPage(number);
      if (cancelled) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / size[0]) * ratio });
      const node = canvas.current!;
      node.width = Math.floor(viewport.width);
      node.height = Math.floor(viewport.height);
      task = page.render({
        canvas: node,
        canvasContext: node.getContext("2d")!,
        viewport,
        background: "white",
      });
      await task.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, size, visible, width]);
  return (
    <canvas
      ref={canvas}
      className="pdf-page"
      style={{ width, aspectRatio: `${size[0]} / ${size[1]}` }}
      aria-label={`Page ${number}`}
      role="img"
    />
  );
}

export default function PdfViewer({
  kind,
  id,
  title,
  onDownload,
}: {
  kind: string;
  id: string;
  title: string;
  onDownload?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [run, setRun] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [blobUrl, setBlobUrl] = useState("");
  const pages = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let doc: PDFDocumentProxy | undefined,
      url = "",
      timer = 0;
    const sleep = (seconds: number) =>
      new Promise((resolve) => {
        timer = window.setTimeout(resolve, seconds * 1000);
      });
    (async () => {
      setPhase({ name: "loading" });
      for (let attempt = 0; ; attempt++) {
        try {
          const bytes = await fetchPdf(kind, id, controller.signal);
          url = URL.createObjectURL(
            new Blob([bytes], { type: "application/pdf" }),
          );
          setBlobUrl(url);
          doc = await getDocument({
            data: bytes,
            enableXfa: false,
            wasmUrl: "/pdfjs/wasm/",
          }).promise;
          const sizes: [number, number][] = [];
          for (let n = 1; n <= doc.numPages; n++) {
            const view = (await doc.getPage(n)).getViewport({ scale: 1 });
            sizes.push([view.width, view.height]);
          }
          if (!controller.signal.aborted)
            setPhase({ name: "ready", doc, sizes });
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof Retryable && attempt < backoff.length) {
            wake(true);
            setPhase({ name: "waking", attempt: attempt + 1 });
            await sleep(backoff[attempt]);
            if (controller.signal.aborted) return;
            continue;
          }
          setPhase({
            name: "error",
            message:
              error instanceof Retryable
                ? "The library is taking longer than usual to wake up."
                : error instanceof Error && error.message
                  ? error.message
                  : "The preview could not be loaded.",
          });
          return;
        }
      }
    })();
    return () => {
      controller.abort();
      clearTimeout(timer);
      doc?.loadingTask.destroy();
      if (url) URL.revokeObjectURL(url);
    };
  }, [kind, id, run]);

  useEffect(() => {
    const node = pages.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [phase.name]);

  const retry = useCallback(() => setRun((n) => n + 1), []);
  const pageWidth = Math.max(240, Math.round((width - 24) * zoom));

  return (
    <div className="pdf-viewer" aria-label={`PDF preview: ${title}`}>
      <div className="pdf-toolbar">
        <span className="muted">
          {phase.name === "ready"
            ? `${phase.sizes.length} page${phase.sizes.length === 1 ? "" : "s"}`
            : "Preview"}
        </span>
        <div className="row-actions">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={phase.name !== "ready" || zoom <= 0.6}
            onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            aria-label="Fit to width"
            disabled={phase.name !== "ready"}
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={phase.name !== "ready" || zoom >= 2.4}
            onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(1)))}
          >
            <Plus size={15} />
          </button>
          {blobUrl && (
            <a
              className="pdf-tool-link"
              href={blobUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={15} /> Open
            </a>
          )}
          {onDownload && (
            <button type="button" onClick={onDownload}>
              <Download size={15} /> Download
            </button>
          )}
        </div>
      </div>
      <div className="pdf-pages" ref={pages}>
        {phase.name === "ready" ? (
          phase.sizes.map((size, i) => (
            <Page
              key={i}
              doc={phase.doc}
              number={i + 1}
              size={size}
              width={pageWidth}
            />
          ))
        ) : phase.name === "error" ? (
          <div className="pdf-state" role="alert">
            <strong>We couldn’t open the preview.</strong>
            <p>{phase.message}</p>
            <div className="row-actions">
              <button type="button" onClick={retry}>
                <RefreshCw size={15} /> Try again
              </button>
              {onDownload && (
                <button type="button" onClick={onDownload}>
                  <Download size={15} /> Download PDF
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="pdf-state" role="status">
            <Loader2 className="spin" size={26} aria-hidden />
            <strong>
              {phase.name === "waking"
                ? "Waking up the library…"
                : "Loading preview…"}
            </strong>
            <p>
              {phase.name === "waking"
                ? `The server was resting. Retrying automatically (attempt ${phase.attempt} of ${backoff.length}).`
                : "Fetching the paper."}
            </p>
            <div className="pdf-skeleton" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}
