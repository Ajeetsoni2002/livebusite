import { lazy, Suspense, useEffect, useState } from "react";
import type { StudioResult } from "./ProcessStudio";
const ProcessStudio = lazy(() => import("./ProcessStudio"));
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { UploadCloud } from "lucide-react";
import { api, apiUrl, errorMessage } from "../../lib/api";
import { ensureAwake } from "../../lib/wake";
import { toast } from "../../components/Feedback";
import { useUser } from "./Auth";
import { usePublic } from "../../lib/queries";
import type { Offering, ContentItem } from "../../lib/types";
import OfferingPicker from "./OfferingPicker";
type Row = {
  title: string;
  offerings: string[];
  year: string;
  examType: string;
};
export default function Upload() {
  const user = useUser(),
    [params] = useSearchParams(),
    navigate = useNavigate(),
    client = useQueryClient(),
    [kind, setKind] = useState(params.get("kind") || "papers"),
    [format, setFormat] = useState("pdf"),
    [files, setFiles] = useState<File[]>([]),
    [rows, setRows] = useState<Row[]>([]),
    [chosen, setChosen] = useState<string[]>([]),
    [created, setCreated] = useState<Offering[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [studio, setStudio] = useState<{
      bytes: Uint8Array;
      metadata: Record<string, unknown>;
      file: File;
    } | null>(null);
  const upload = {
    // Large scans on slow connections to a free instance can take minutes.
    timeout: 600_000,
    onUploadProgress: (event: { loaded: number; total?: number }) =>
      event.total &&
      setProgress(Math.round((event.loaded / event.total) * 100)),
  };
  const edit = params.get("edit"),
    offerings = usePublic<Offering[]>("/offerings"),
    item = useQuery({
      queryKey: ["edit", kind, edit],
      queryFn: async () =>
        (await api.get(`/${user.role}/${kind}/${edit}`)).data
          .data as ContentItem,
      enabled: !!edit,
    });
  useEffect(() => {
    if (item.data) {
      setFormat(item.data.format || "pdf");
      setChosen(
        (item.data.offerings || []).map((offering) =>
          typeof offering === "string" ? offering : offering._id,
        ),
      );
    }
  }, [item.data]);
  function choose(list: File[]) {
    setFiles(list.slice(0, 5));
    setRows(
      list.slice(0, 5).map((file) => ({
        title: file.name.replace(/\.pdf$/i, ""),
        offerings: [],
        year: "",
        examType: "Unknown",
      })),
    );
  }
  // Offerings created from the picker show up at once; the public list is cached briefly.
  const loaded = offerings.data?.data || [],
    options = [
      ...loaded,
      ...created.filter((c) => !loaded.some((o) => o._id === c._id)),
    ],
    onCreate =
      user.role === "admin"
        ? (offering: Offering) => setCreated((old) => [...old, offering])
        : undefined;
  // Never send a file into a sleeping API: the request would be lost while it boots.
  const wakeFirst = () =>
    ensureAwake(() => {
      setMessage("Waking up the server… this can take up to a minute.");
      toast("Waking up the server… your upload starts automatically.");
    });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProgress(null);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      if (files.length > 1 && !edit) {
        if (rows.some((r) => !r.offerings.length))
          throw new Error("Choose at least one subject for every PDF.");
        const data = new FormData();
        files.forEach((f) => data.append("files", f));
        data.append(
          "metadata",
          JSON.stringify(
            rows.map((row) => ({
              title: row.title,
              offerings: row.offerings,
              ...(kind === "papers"
                ? {
                    year: row.year ? Number(row.year) : undefined,
                    examType: row.examType,
                  }
                : { format: "pdf" }),
              ...(user.role === "admin"
                ? { status: String(form.get("status") || "pending") }
                : {}),
            })),
          ),
        );
        await wakeFirst();
        const result = await api.post(
          `/${user.role}/${kind}/bulk`,
          data,
          upload,
        );
        setMessage(
          result.data.data
            .map(
              (r: { index: number; error?: string; item?: ContentItem }) =>
                `${files[r.index].name}: ${r.error || r.item?.status}`,
            )
            .join("\n"),
        );
        setFiles([]);
      } else {
        const metadata: Record<string, unknown> = {
          title: String(form.get("title")),
          offerings: chosen,
          credit: String(form.get("credit") || ""),
          tags: String(form.get("tags") || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
        if (!chosen.length)
          throw new Error("Choose at least one subject / branch / semester.");
        if (kind === "papers") {
          if (form.get("year")) metadata.year = Number(form.get("year"));
          metadata.examType = String(form.get("examType") || "Unknown");
          metadata.session = String(form.get("session") || "");
        } else {
          metadata.format = format;
          metadata.unit = String(form.get("unit") || "");
          metadata.topic = String(form.get("topic") || "");
          if (format === "markdown")
            metadata.markdown = String(form.get("markdown") || "");
        }
        if (user.role === "admin")
          metadata.status = String(form.get("status") || "pending");
        if (edit) {
          await api.patch(`/${user.role}/${kind}/${edit}`, metadata);
          if (files[0]) {
            await wakeFirst();
            const replacement = new FormData();
            replacement.append("file", files[0]);
            await api.post(
              `/${user.role}/${kind}/${edit}/replace-file`,
              replacement,
              upload,
            );
          }
        } else if (files[0] && format === "pdf") {
          // Preview the cleaned/split version first; the upload happens on the choice.
          setStudio({
            bytes: new Uint8Array(await files[0].arrayBuffer()),
            metadata,
            file: files[0],
          });
          return;
        } else {
          const data = new FormData();
          data.append("metadata", JSON.stringify(metadata));
          if (files[0]) data.append("file", files[0]);
          await wakeFirst();
          await api.post(`/${user.role}/${kind}`, data, upload);
        }
        setMessage(edit ? "Resource updated." : "Uploaded successfully.");
        await client.invalidateQueries({ queryKey: ["staff-content"] });
        navigate(`/${user.role}${user.role === "admin" ? `/${kind}` : ""}`);
      }
    } catch (error) {
      setMessage(errorMessage(error));
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  async function sendWithChoice(result: StudioResult) {
    if (!studio) return;
    setBusy(true);
    setMessage("");
    try {
      const data = new FormData();
      data.append(
        "metadata",
        JSON.stringify({
          ...studio.metadata,
          ...(result.choice === "processed"
            ? { useVersion: "processed", processedMeta: result.meta }
            : {}),
        }),
      );
      data.append("file", studio.file);
      if (result.choice === "processed")
        data.append(
          "processed",
          new File(
            [result.blob],
            studio.file.name.replace(/.pdf$/i, "") + "-processed.pdf",
            {
              type: "application/pdf",
            },
          ),
        );
      await wakeFirst();
      await api.post(`/${user.role}/${kind}`, data, upload);
      setStudio(null);
      toast(
        user.role === "admin"
          ? "Uploaded. The watermark is being added."
          : "Uploaded! It will appear after review.",
        "success",
      );
      await client.invalidateQueries({ queryKey: ["staff-content"] });
      navigate(`/${user.role}${user.role === "admin" ? `/${kind}` : ""}`);
    } catch (error) {
      // The studio stays open and shows this, so the choice can be retried.
      setMessage(errorMessage(error));
      throw new Error(`Upload failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  if (edit && item.isPending) return <p>Loading resource…</p>;
  const data = item.data;
  return (
    <>
      <h2>{edit ? "Inspect / edit resource" : "Share a resource"}</h2>
      <p>
        {user.role === "contributor"
          ? "Your submission will be reviewed before publication."
          : "Upload PDFs with metadata, or write a Markdown note."}
      </p>
      <div className="toolbar">
        <label>
          Resource type
          <select
            aria-label="Resource type"
            value={kind}
            disabled={!!edit}
            onChange={(e) => {
              setKind(e.target.value);
              setFiles([]);
            }}
          >
            <option value="papers">Question paper</option>
            <option value="notes">Short note</option>
          </select>
        </label>
        {kind === "notes" && (
          <label>
            Format
            <select
              aria-label="Format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <option value="pdf">PDF</option>
              <option value="markdown">Markdown</option>
            </select>
          </label>
        )}
      </div>
      {data?.metadataNeedsReview && (
        <div className="notice">
          Source conflicts: {data.provenance?.conflicts?.join("; ")}. Verify the
          PDF and correct metadata before approval.
        </div>
      )}
      {edit && format === "pdf" && (
        <a
          className="text-link"
          href={apiUrl(`/${kind}/${edit}/preview`)}
          target="_blank"
          rel="noreferrer"
        >
          Inspect current PDF →
        </a>
      )}
      <form
        className="card staff-card staff-form"
        onSubmit={submit}
        key={`${edit || "new"}-${kind}-${data?._id || "loading"}`}
      >
        {format === "pdf" && (
          <div
            className="dropzone wide"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(Array.from(e.dataTransfer.files));
            }}
          >
            <UploadCloud size={30} />
            <p>
              Drop PDFs here, or choose files.
              <br />
              Up to 5 PDFs per batch, 20 MB each by default.
            </p>
            <input
              aria-label="Choose PDFs"
              type="file"
              accept="application/pdf,.pdf"
              multiple={!edit}
              onChange={(e) => choose(Array.from(e.target.files || []))}
            />
          </div>
        )}
        {files.length > 1 && !edit ? (
          <div className="table-scroll wide">
            <table className="data-table">
              <thead>
                <tr>
                  <th>FILE / TITLE</th>
                  <th>SUBJECT OFFERING</th>
                  {kind === "papers" && (
                    <>
                      <th>YEAR</th>
                      <th>EXAM TYPE</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>
                      <small>{files[i].name}</small>
                      <input
                        aria-label={`Title ${i + 1}`}
                        value={row.title}
                        onChange={(e) =>
                          setRows((old) =>
                            old.map((r, index) =>
                              index === i ? { ...r, title: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="offering-cell">
                      <OfferingPicker
                        label={`Subject ${i + 1}`}
                        options={options}
                        onCreate={onCreate}
                        value={row.offerings}
                        onChange={(offerings) =>
                          setRows((old) =>
                            old.map((r, index) =>
                              index === i ? { ...r, offerings } : r,
                            ),
                          )
                        }
                      />
                      {i === 0 &&
                        rows.length > 1 &&
                        row.offerings.length > 0 && (
                          <div className="row-actions">
                            <button
                              type="button"
                              onClick={() =>
                                setRows((old) =>
                                  old.map((r) => ({
                                    ...r,
                                    offerings: row.offerings,
                                  })),
                                )
                              }
                            >
                              Use these subjects for all files
                            </button>
                          </div>
                        )}
                    </td>
                    {kind === "papers" && (
                      <>
                        <td>
                          <input
                            type="number"
                            min="1900"
                            max="2200"
                            aria-label={`Year ${i + 1}`}
                            value={row.year}
                            onChange={(e) =>
                              setRows((old) =>
                                old.map((r, index) =>
                                  index === i
                                    ? { ...r, year: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`Exam ${i + 1}`}
                            value={row.examType}
                            onChange={(e) =>
                              setRows((old) =>
                                old.map((r, index) =>
                                  index === i
                                    ? { ...r, examType: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          >
                            {[
                              "Unknown",
                              "Mid-Sem",
                              "End-Sem",
                              "Supplementary",
                              "Other",
                            ].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <label className="wide">
              Title
              <input
                name="title"
                required
                minLength={3}
                maxLength={240}
                defaultValue={data?.title}
              />
            </label>
            <div className="wide field">
              <span>Subject / branch / semester (select all that apply)</span>
              <OfferingPicker
                label="Subject / branch / semester"
                options={options}
                onCreate={onCreate}
                value={chosen}
                onChange={setChosen}
              />
            </div>
            {kind === "papers" ? (
              <>
                <label>
                  Year
                  <input
                    type="number"
                    name="year"
                    min="1900"
                    max="2200"
                    defaultValue={data?.year}
                  />
                </label>
                <label>
                  Exam type
                  <select
                    name="examType"
                    defaultValue={data?.examType || "Unknown"}
                  >
                    {[
                      "Unknown",
                      "Mid-Sem",
                      "End-Sem",
                      "Supplementary",
                      "Other",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Session
                  <input
                    name="session"
                    defaultValue={data?.session}
                    placeholder="Only enter a verified session"
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Unit
                  <input name="unit" defaultValue={data?.unit} />
                </label>
                <label>
                  Topic
                  <input name="topic" defaultValue={data?.topic} />
                </label>
                {format === "markdown" && (
                  <label className="wide">
                    Markdown content
                    <textarea
                      name="markdown"
                      required
                      maxLength={100000}
                      rows={16}
                      defaultValue={data?.markdown}
                    />
                  </label>
                )}
              </>
            )}
            <label>
              Author credit
              <input
                name="credit"
                defaultValue={data?.credit}
                maxLength={160}
              />
            </label>
            <label>
              Tags · comma separated
              <input name="tags" defaultValue={data?.tags?.join(", ")} />
            </label>
          </>
        )}
        {user.role === "admin" && (
          <label>
            Status
            <select name="status" defaultValue={data?.status || "pending"}>
              {["draft", "pending", "published"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <button className="button wide" disabled={busy}>
          {busy
            ? "Saving…"
            : edit
              ? "Save changes"
              : files.length > 1
                ? "Upload batch"
                : "Submit resource"}
        </button>
        {busy && progress !== null && (
          <div className="upload-progress wide" role="status">
            <div
              className="upload-progress-bar"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span style={{ transform: `scaleX(${progress / 100})` }} />
            </div>
            <small>
              {progress < 100
                ? `Uploading… ${progress}%`
                : "Processing on the server…"}
            </small>
          </div>
        )}
        {message && (
          <p
            className="notice wide"
            role="status"
            style={{ whiteSpace: "pre-line" }}
          >
            {message}
          </p>
        )}
      </form>
      {studio && (
        <Suspense fallback={<p role="status">Opening the preview…</p>}>
          <ProcessStudio
            bytes={studio.bytes}
            title={String(studio.metadata.title || studio.file.name)}
            onCancel={() => setStudio(null)}
            onDone={sendWithChoice}
            originalLabel="Upload original file"
            processedLabel="Upload processed version"
          />
        </Suspense>
      )}
    </>
  );
}
