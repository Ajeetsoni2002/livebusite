import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Loader2, Stamp } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { confirmDialog, toast } from "../../components/Feedback";

type Watermark = {
  enabled: boolean;
  template: string;
  opacity: number;
  angle: number;
  fontSize: number;
  tiled: boolean;
  footer: boolean;
  skipIfContains: string;
};
type Counts = Partial<Record<"queued" | "running" | "done" | "failed", number>>;

/** Polls a job batch until nothing is queued or running. */
function useBatch(batch: string | null) {
  const query = useQuery({
    queryKey: ["jobs", batch],
    enabled: !!batch,
    queryFn: async () =>
      (await api.get("/admin/jobs/summary", { params: { batch } })).data
        .data as {
        counts: Counts;
        failed: { error?: string }[];
      },
    refetchInterval: (q) => {
      const c = q.state.data?.counts || {};
      return (c.queued || 0) + (c.running || 0) > 0 || !q.state.data
        ? 3000
        : false;
    },
  });
  const c = query.data?.counts || {};
  const total =
    (c.queued || 0) + (c.running || 0) + (c.done || 0) + (c.failed || 0);
  return { counts: c, total, finished: total > 0 && !c.queued && !c.running };
}

function BatchProgress({
  batch,
  label,
}: {
  batch: string | null;
  label: string;
}) {
  const { counts, total, finished } = useBatch(batch);
  if (!batch) return null;
  const done = (counts.done || 0) + (counts.failed || 0);
  return (
    <div className="upload-progress" role="status">
      <div className="upload-progress-bar">
        <span style={{ transform: `scaleX(${total ? done / total : 0})` }} />
      </div>
      <small>
        {finished
          ? `${label}: ${counts.done || 0} done${counts.failed ? `, ${counts.failed} failed` : ""}.`
          : `${label}: ${done} of ${total || "…"} — this keeps running on the server; you can leave this page.`}
      </small>
    </div>
  );
}

export default function Settings() {
  const settings = useQuery({
    queryKey: ["watermark-settings"],
    queryFn: async () =>
      (await api.get("/admin/settings/watermark")).data.data as {
        settings: Watermark;
        revision: number;
        defaults: Watermark;
      },
  });
  const [form, setForm] = useState<Watermark | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyBatch, setApplyBatch] = useState<string | null>(null);
  const [thumbBatch, setThumbBatch] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data.settings);
  }, [settings.data, form]);
  if (settings.isPending || !form)
    return settings.isError ? (
      <p className="notice error">{errorMessage(settings.error)}</p>
    ) : (
      <p role="status">Loading settings…</p>
    );
  const set = <K extends keyof Watermark>(key: K, value: Watermark[K]) =>
    setForm((old) => ({ ...old!, [key]: value }));
  const sample = form.template.replaceAll("{subjectCode}", "CSE-703");

  async function save() {
    setSaving(true);
    try {
      await api.put("/admin/settings/watermark", form);
      await settings.refetch();
      toast(
        "Watermark settings saved. New uploads use them; apply them to existing items below.",
        "success",
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }
  async function applyAll() {
    try {
      const dry = (
        await api.post("/admin/watermark/apply", { scope: "all", dryRun: true })
      ).data.data;
      if (!dry.count)
        return toast(
          "Every item already has the current watermark.",
          "success",
        );
      if (
        !(await confirmDialog({
          title: `Watermark ${dry.count} item(s)?`,
          body: "Each item keeps serving its current file until its new watermarked copy is ready. Originals are never changed.",
          confirmLabel: "Apply watermark",
        }))
      )
        return;
      const run = (await api.post("/admin/watermark/apply", { scope: "all" }))
        .data.data;
      setApplyBatch(run.batch);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function repairThumbnails() {
    try {
      toast("Checking covers…");
      const dry = (await api.post("/admin/thumbnails/repair", { dryRun: true }))
        .data.data;
      if (!dry.count)
        return toast("Every item has a cover thumbnail.", "success");
      if (
        !(await confirmDialog({
          title: `Rebuild ${dry.count} missing cover(s)?`,
          confirmLabel: "Rebuild covers",
        }))
      )
        return;
      setThumbBatch(
        (await api.post("/admin/thumbnails/repair", { dryRun: false })).data
          .data.batch,
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <>
      <div className="section-head">
        <h2>Settings</h2>
        <span className="muted">Revision {settings.data?.revision ?? 0}</span>
      </div>
      <section className="card staff-card settings-card">
        <h3>
          <Stamp size={18} /> Watermark
        </h3>
        <p className="muted">
          Added by the server to every PDF students receive. Originals are kept
          unchanged. Use <code>{"{subjectCode}"}</code> for the first subject’s
          code.
        </p>
        <div className="settings-grid">
          <div className="staff-form">
            <label className="wide inline-check">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
              />
              <span>Watermark PDFs</span>
            </label>
            <label className="wide">
              Text
              <input
                value={form.template}
                maxLength={80}
                onChange={(e) => set("template", e.target.value)}
              />
            </label>
            <label>
              Opacity {Math.round(form.opacity * 100)}%
              <input
                type="range"
                min={3}
                max={40}
                value={Math.round(form.opacity * 100)}
                onChange={(e) => set("opacity", Number(e.target.value) / 100)}
              />
            </label>
            <label>
              Angle {form.angle}°
              <input
                type="range"
                min={-90}
                max={90}
                value={form.angle}
                onChange={(e) => set("angle", Number(e.target.value))}
              />
            </label>
            <label>
              Size
              <input
                type="number"
                min={10}
                max={80}
                value={form.fontSize}
                onChange={(e) => set("fontSize", Number(e.target.value))}
              />
            </label>
            <label>
              Skip PDFs that already contain
              <input
                value={form.skipIfContains}
                maxLength={60}
                onChange={(e) => set("skipIfContains", e.target.value)}
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={form.tiled}
                onChange={(e) => set("tiled", e.target.checked)}
              />
              <span>Repeat across the page</span>
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={form.footer}
                onChange={(e) => set("footer", e.target.checked)}
              />
              <span>Footer line</span>
            </label>
            <div className="wide row-actions">
              <button className="button" disabled={saving} onClick={save}>
                {saving ? <Loader2 className="spin" size={16} /> : null} Save
                settings
              </button>
              <button onClick={() => setForm(settings.data!.defaults)}>
                Reset to defaults
              </button>
            </div>
          </div>
          <div className="wm-preview" aria-label="Watermark preview">
            {form.enabled &&
              (form.tiled
                ? Array.from({ length: 9 }, (_, i) => (
                    <span
                      key={i}
                      style={{
                        opacity: form.opacity * 2.2,
                        transform: `rotate(${-form.angle}deg)`,
                        fontSize: `${form.fontSize / 3}px`,
                        top: `${8 + Math.floor(i / 3) * 32}%`,
                        left: `${(i % 3) * 34 - (Math.floor(i / 3) % 2) * 14}%`,
                      }}
                    >
                      {sample}
                    </span>
                  ))
                : [
                    <span
                      key="one"
                      style={{
                        opacity: form.opacity * 3,
                        transform: `rotate(${-form.angle}deg)`,
                        fontSize: `${form.fontSize / 2.5}px`,
                        top: "45%",
                        left: "15%",
                      }}
                    >
                      {sample}
                    </span>,
                  ])}
            <div className="wm-lines" aria-hidden="true" />
            {form.enabled && form.footer && (
              <small className="wm-footer">{sample}</small>
            )}
          </div>
        </div>
      </section>
      <section className="card staff-card settings-card">
        <h3>Apply to existing items</h3>
        <p className="muted">
          Watermarks every paper and note that does not yet carry the current
          settings, including the older archive. Items that already contain “
          {form.skipIfContains}” are left as they are.
        </p>
        <div className="row-actions">
          <button onClick={applyAll}>
            <Stamp size={15} /> Apply watermark to all outdated items
          </button>
        </div>
        <BatchProgress batch={applyBatch} label="Watermarking" />
      </section>
      <section className="card staff-card settings-card">
        <h3>
          <ImageOff size={18} /> Missing cover thumbnails
        </h3>
        <p className="muted">
          Rebuilds cover images whose files are missing from storage.
        </p>
        <div className="row-actions">
          <button onClick={repairThumbnails}>
            Find and rebuild missing covers
          </button>
        </div>
        <BatchProgress batch={thumbBatch} label="Rebuilding covers" />
      </section>
    </>
  );
}
