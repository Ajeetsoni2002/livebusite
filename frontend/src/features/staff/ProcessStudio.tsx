import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  Loader2,
  RotateCw,
  Scissors,
  Sparkles,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  MAX_PAGES,
  analyzeDocument,
  assemblePdf,
  buildPage,
  openPdf,
  releaseParts,
  reportOf,
  type OutputPart,
  type PageInfo,
  type Settings,
} from "../../lib/processing/browser";
import {
  defaultDecision,
  type PageDecision,
} from "../../lib/processing/pipeline";
import type { Preset } from "../../lib/processing/core";

export type StudioResult =
  | { choice: "original" }
  | { choice: "processed"; blob: Blob; meta: ReturnType<typeof reportOf> };

type Phase =
  | {
      name: "analysing" | "building" | "assembling";
      done: number;
      total: number;
    }
  | { name: "ready" }
  | { name: "error"; message: string };

const presets: [Preset, string][] = [
  ["grayscale", "Clean grayscale (best for most papers)"],
  ["bw", "Clean black & white (text only)"],
  ["color", "Colour enhanced (diagrams)"],
];

/**
 * Original | processed comparison with per-page overrides. Everything runs in the browser
 * so the free API never does heavy image work; the server only adds the watermark.
 */
export default function ProcessStudio({
  bytes,
  title,
  onCancel,
  onDone,
  originalLabel = "Use original file",
  processedLabel = "Use processed version",
}: {
  bytes: Uint8Array;
  title: string;
  onCancel: () => void;
  onDone: (result: StudioResult) => Promise<void> | void;
  originalLabel?: string;
  processedLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const doc = useRef<PDFDocumentProxy | null>(null);
  const [phase, setPhase] = useState<Phase>({
    name: "analysing",
    done: 0,
    total: 0,
  });
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [decisions, setDecisions] = useState<PageDecision[]>([]);
  const [settings, setSettings] = useState<Settings>({
    mode: "needed",
    preset: "grayscale",
  });
  const [applied, setApplied] = useState<Settings>(settings);
  const [parts, setParts] = useState<Record<number, OutputPart[]>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState("");
  const [reveal, setReveal] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [busyPage, setBusyPage] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const partsRef = useRef(parts);
  partsRef.current = parts;

  useEffect(() => {
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let cancelled = false;
    (async () => {
      try {
        const pdf = await openPdf(bytes);
        doc.current = pdf;
        if (pdf.numPages > MAX_PAGES)
          throw new Error(
            `This PDF has ${pdf.numPages} pages. Processing in the browser supports up to ${MAX_PAGES}; use the original file.`,
          );
        const info = await analyzeDocument(pdf, (done, total) => {
          if (!cancelled) setPhase({ name: "analysing", done, total });
        });
        if (cancelled) return;
        setPages(info);
        const initial = info.map(() => ({ ...defaultDecision }));
        setDecisions(initial);
        const built: Record<number, OutputPart[]> = {};
        for (const page of info) {
          if (cancelled) return;
          setPhase({ name: "building", done: page.index, total: info.length });
          built[page.index] = await buildPage(
            pdf,
            page,
            initial[page.index],
            settings,
          );
        }
        setParts(built);
        const ids = info.flatMap((p) => built[p.index].map((part) => part.id));
        setOrder(ids);
        setSelected(ids[0]);
        setPhase({ name: "ready" });
      } catch (error) {
        if (!cancelled)
          setPhase({
            name: "error",
            message:
              error instanceof Error
                ? error.message
                : "This PDF could not be processed.",
          });
      }
    })();
    return () => {
      cancelled = true;
      document.body.style.overflow = overflow;
      Object.values(partsRef.current).forEach(releaseParts);
      void doc.current?.loadingTask.destroy();
    };
    // Runs once per opened file.
  }, [bytes]);
  useEffect(
    () => () => pages.forEach((p) => URL.revokeObjectURL(p.originalUrl)),
    [pages],
  );

  const byId = useMemo(() => {
    const map = new Map<string, OutputPart>();
    Object.values(parts).forEach((list) =>
      list.forEach((p) => map.set(p.id, p)),
    );
    return map;
  }, [parts]);
  const current = byId.get(selected);
  const page = current ? pages[current.page] : undefined;
  const decision = current ? decisions[current.page] : undefined;
  const visible = order.filter((id) => byId.has(id) && !hidden.has(id));
  const dirtySettings =
    settings.mode !== applied.mode || settings.preset !== applied.preset;

  /** Rebuilds one page after a per-page change, keeping its place in the order. */
  async function rebuild(index: number, next: PageDecision, use = applied) {
    if (!doc.current) return;
    setBusyPage(index);
    try {
      const fresh = await buildPage(doc.current, pages[index], next, use);
      setParts((old) => {
        releaseParts(old[index] || []);
        return { ...old, [index]: fresh };
      });
      setOrder((old) => {
        const firstAt = old.findIndex((id) => id.startsWith(`${index}:`));
        const rest = old.filter((id) => !id.startsWith(`${index}:`));
        const at = firstAt < 0 ? rest.length : Math.min(firstAt, rest.length);
        return [
          ...rest.slice(0, at),
          ...fresh.map((p) => p.id),
          ...rest.slice(at),
        ];
      });
      setSelected((id) =>
        byId.has(id) && id.startsWith(`${index}:`) ? fresh[0].id : id,
      );
    } finally {
      setBusyPage(null);
    }
  }
  function decide(change: Partial<PageDecision>) {
    if (!current) return;
    const next = { ...decisions[current.page], ...change };
    setDecisions((old) => old.map((d, i) => (i === current.page ? next : d)));
    void rebuild(current.page, next);
  }
  async function reprocessAll() {
    if (!doc.current) return;
    const use = settings;
    for (const p of pages) {
      setPhase({ name: "building", done: p.index, total: pages.length });
      await rebuild(p.index, decisions[p.index], use);
    }
    setApplied(use);
    setPhase({ name: "ready" });
  }
  function move(id: string, delta: number) {
    setOrder((old) => {
      const list = old.filter((x) => byId.has(x));
      const i = list.indexOf(id),
        j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return old;
      [list[i], list[j]] = [list[j], list[i]];
      return list;
    });
  }
  async function finish(choice: "original" | "processed") {
    setSaving(true);
    try {
      if (choice === "original") return await onDone({ choice });
      const chosen = visible.map((id) => byId.get(id)!);
      if (!chosen.length) throw new Error("Keep at least one page.");
      const blob = await assemblePdf(bytes, chosen, decisions, (done, total) =>
        setPhase({ name: "assembling", done, total }),
      );
      setPhase({ name: "ready" });
      await onDone({ choice, blob, meta: reportOf(pages, chosen, applied) });
    } catch (error) {
      setPhase({
        name: "error",
        message:
          error instanceof Error ? error.message : "Could not build the PDF.",
      });
    } finally {
      setSaving(false);
    }
  }

  const progress =
    phase.name === "analysing" ||
    phase.name === "building" ||
    phase.name === "assembling"
      ? phase
      : null;
  const spread = page?.bornDigital ? page.textSpread : page?.raster?.spread;

  return (
    <dialog
      ref={dialog}
      className="studio"
      aria-label={`Process ${title}`}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onCancel();
      }}
    >
      <header className="studio-head">
        <div>
          <span className="eyebrow">PROCESS & PREVIEW</span>
          <h2>{title}</h2>
        </div>
        <div className="studio-global">
          <label>
            Clean up
            <select
              value={settings.mode}
              disabled={!!progress}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  mode: e.target.value as Settings["mode"],
                }))
              }
            >
              <option value="needed">Only photo pages</option>
              <option value="all">Every scanned page</option>
              <option value="none">No clean-up</option>
            </select>
          </label>
          <label>
            Style
            <select
              value={settings.preset}
              disabled={!!progress}
              onChange={(e) =>
                setSettings((s) => ({ ...s, preset: e.target.value as Preset }))
              }
            >
              {presets.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {dirtySettings && (
            <button
              className="button"
              onClick={reprocessAll}
              disabled={!!progress}
            >
              Re-process all
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Close"
            disabled={saving}
            onClick={onCancel}
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {phase.name === "error" ? (
        <div className="studio-state" role="alert">
          <TriangleAlert size={28} />
          <strong>Processing stopped.</strong>
          <p>{phase.message}</p>
          <div className="row-actions">
            <button onClick={() => finish("original")} disabled={saving}>
              {originalLabel}
            </button>
            <button onClick={onCancel}>Close</button>
          </div>
        </div>
      ) : !order.length && progress ? (
        <div className="studio-state" role="status">
          <Loader2 className="spin" size={28} />
          <strong>
            {progress.name === "analysing" ? "Reading pages" : "Cleaning pages"}{" "}
            — {Math.min(progress.done + 1, progress.total || 1)} of{" "}
            {progress.total || "…"}
          </strong>
          <div className="upload-progress-bar studio-bar">
            <span
              style={{
                transform: `scaleX(${progress.total ? progress.done / progress.total : 0})`,
              }}
            />
          </div>
          <p>
            Everything happens in your browser. Large scans take a few seconds
            per page.
          </p>
        </div>
      ) : (
        <div className="studio-body">
          <ol className="studio-pages" aria-label="Output pages">
            {order
              .filter((id) => byId.has(id))
              .map((id) => {
                const part = byId.get(id)!;
                const info = pages[part.page];
                const flags = info.bornDigital
                  ? info.textSpread
                  : info.raster?.spread;
                const off = hidden.has(id);
                return (
                  <li key={id}>
                    <button
                      className={`studio-thumb ${selected === id ? "active" : ""} ${off ? "off" : ""}`}
                      onClick={() => setSelected(id)}
                      aria-current={selected === id}
                    >
                      <img src={part.url} alt="" />
                      <span>
                        Page {part.page + 1}
                        {part.split ? ` · ${"ab"[part.part]}` : ""}
                      </span>
                      <span className="studio-flags">
                        {part.split && (
                          <Scissors size={12} aria-label="Split" />
                        )}
                        {part.enhanced && (
                          <Sparkles size={12} aria-label="Cleaned" />
                        )}
                        {flags?.review && !part.split && (
                          <TriangleAlert
                            size={12}
                            aria-label="Check: possible two-page spread"
                          />
                        )}
                        {off && <EyeOff size={12} aria-label="Removed" />}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ol>

          <section className="studio-main" aria-label="Comparison">
            {current && page ? (
              <>
                <div className="studio-compare-tools">
                  <span className="muted">
                    Original ← drag → Processed
                    {busyPage === current.page && " · updating…"}
                  </span>
                  <div className="row-actions">
                    <button
                      aria-label="Zoom out"
                      onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
                    >
                      <ZoomOut size={15} />
                    </button>
                    <button
                      aria-label="Zoom in"
                      onClick={() => setZoom((z) => Math.min(2.4, z + 0.2))}
                    >
                      <ZoomIn size={15} />
                    </button>
                  </div>
                </div>
                <div className="studio-compare">
                  <div
                    className="studio-stage"
                    style={{ width: `${zoom * 100}%` }}
                  >
                    <img
                      className="studio-after"
                      src={current.url}
                      alt="Processed page"
                    />
                    <div
                      className="studio-before"
                      role="img"
                      aria-label="Original page"
                      style={{
                        backgroundImage: `url(${page.originalUrl})`,
                        backgroundSize: `${100 / current.region.w}% ${100 / current.region.h}%`,
                        backgroundPosition: `${current.region.w < 1 ? (current.region.x / (1 - current.region.w)) * 100 : 0}% ${current.region.h < 1 ? (current.region.y / (1 - current.region.h)) * 100 : 0}%`,
                        clipPath: `inset(0 ${100 - reveal}% 0 0)`,
                      }}
                    />
                    <span
                      className="studio-divider"
                      style={{ left: `${reveal}%` }}
                    />
                  </div>
                </div>
                <input
                  className="studio-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={reveal}
                  aria-label="Compare original and processed"
                  onChange={(e) => setReveal(Number(e.target.value))}
                />
              </>
            ) : (
              <p className="muted">Select a page.</p>
            )}
          </section>

          <aside className="studio-side" aria-label="Page options">
            {current && page && decision && (
              <>
                <h3>Page {current.page + 1}</h3>
                <p className="muted small">
                  {page.bornDigital
                    ? "Digital page: kept as text, only watermarked."
                    : `Photo-likeness ${Math.round((page.raster?.photo.score || 0) * 100)}%.`}{" "}
                  {spread?.split
                    ? `Two pages detected (${Math.round(spread.confidence * 100)}% sure).`
                    : spread?.review
                      ? "Might be two pages — please check."
                      : "Single page."}
                </p>
                <fieldset className="studio-seg">
                  <legend>Split into two pages</legend>
                  {(["auto", "on", "off"] as const).map((v) => (
                    <button
                      key={v}
                      aria-pressed={decision.split === v}
                      disabled={busyPage !== null}
                      onClick={() => decide({ split: v })}
                    >
                      {v === "auto"
                        ? "Auto"
                        : v === "on"
                          ? "Split"
                          : "Keep whole"}
                    </button>
                  ))}
                </fieldset>
                {current.split && (
                  <label className="studio-range">
                    Split position{" "}
                    {Math.round((decision.splitAt ?? spread?.at ?? 0.5) * 100)}%
                    <input
                      type="range"
                      min={25}
                      max={75}
                      value={Math.round(
                        (decision.splitAt ?? spread?.at ?? 0.5) * 100,
                      )}
                      disabled={busyPage !== null}
                      onChange={(e) =>
                        setDecisions((old) =>
                          old.map((d, i) =>
                            i === current.page
                              ? { ...d, splitAt: Number(e.target.value) / 100 }
                              : d,
                          ),
                        )
                      }
                      onPointerUp={() => decide({ split: "on" })}
                      onKeyUp={() => decide({ split: "on" })}
                    />
                  </label>
                )}
                {!page.bornDigital && (
                  <fieldset className="studio-seg">
                    <legend>Clean up this page</legend>
                    {(["auto", "on", "off"] as const).map((v) => (
                      <button
                        key={v}
                        aria-pressed={decision.enhance === v}
                        disabled={busyPage !== null}
                        onClick={() => decide({ enhance: v })}
                      >
                        {v === "auto" ? "Auto" : v === "on" ? "On" : "Off"}
                      </button>
                    ))}
                  </fieldset>
                )}
                <div className="row-actions">
                  <button
                    disabled={busyPage !== null}
                    onClick={() =>
                      decide({
                        turns: ((decision.turns + 1) %
                          4) as PageDecision["turns"],
                      })
                    }
                  >
                    <RotateCw size={15} /> Rotate
                  </button>
                  <button
                    onClick={() =>
                      setHidden((old) => {
                        const next = new Set(old);
                        if (next.has(current.id)) next.delete(current.id);
                        else next.add(current.id);
                        return next;
                      })
                    }
                  >
                    {hidden.has(current.id) ? (
                      <Eye size={15} />
                    ) : (
                      <EyeOff size={15} />
                    )}
                    {hidden.has(current.id) ? "Keep page" : "Remove page"}
                  </button>
                  <button
                    aria-label="Move earlier"
                    onClick={() => move(current.id, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    aria-label="Move later"
                    onClick={() => move(current.id, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      <footer className="studio-foot">
        <span className="muted">
          {pages.length
            ? `${pages.length} page${pages.length === 1 ? "" : "s"} in → ${visible.length} out · ${
                Object.values(parts)
                  .flat()
                  .filter((p) => p.split).length / 2
              } split · ${
                new Set(
                  Object.values(parts)
                    .flat()
                    .filter((p) => p.enhanced)
                    .map((p) => p.page),
                ).size
              } cleaned`
            : " "}
          {phase.name === "assembling" &&
            ` · building PDF ${phase.done}/${phase.total}`}
        </span>
        <div className="row-actions">
          <button onClick={() => finish("original")} disabled={saving}>
            {originalLabel}
          </button>
          <button
            className="studio-primary"
            onClick={() => finish("processed")}
            disabled={
              saving ||
              phase.name !== "ready" ||
              busyPage !== null ||
              dirtySettings
            }
            title={
              dirtySettings
                ? "Re-process first to apply the new settings"
                : undefined
            }
          >
            <Check size={15} /> {saving ? "Saving…" : processedLabel}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
