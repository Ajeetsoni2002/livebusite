import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { api, errorMessage } from "../../lib/api";
import { confirmDialog, toast } from "../../components/Feedback";
import type { SyllabusEntry } from "../../lib/syllabus";

type Subject = { _id: string; name: string; code: string; slug: string };
type AdminSyllabus = Omit<SyllabusEntry, "subject" | "offerings"> & {
  subject: Subject;
  published: boolean;
};
type ImportItem = {
  code: string;
  name: string;
  markdown: string;
  subtitle?: string;
  credits?: SyllabusEntry["credits"];
  branch?: string;
  semester?: number;
};
type ImportResult = {
  created: string[];
  updated: string[];
  renamed: string[];
  unmatched: string[];
  dryRun: boolean;
};
const TEMPLATE = `## Course objectives

1. …

## Unit I – Title

Topics as printed in the syllabus…

## Unit II – Title

…

## Course outcomes

1. …

## Reference books

1. …
`;

/* Requests stay under the API's 256 KB body limit. */
function chunks(items: ImportItem[]) {
  const out: ImportItem[][] = [];
  let current: ImportItem[] = [],
    size = 0;
  for (const item of items) {
    const bytes = new Blob([JSON.stringify(item)]).size;
    if (current.length && size + bytes > 180_000) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += bytes;
  }
  if (current.length) out.push(current);
  return out;
}

function ImportCard({ onDone }: { onDone: () => void }) {
  const [items, setItems] = useState<ImportItem[]>([]),
    [rename, setRename] = useState("placeholders"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<ImportResult | null>(null);
  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const total: ImportResult = {
        created: [],
        updated: [],
        renamed: [],
        unmatched: [],
        dryRun,
      };
      for (const part of chunks(items)) {
        const data = (
          await api.post("/admin/syllabus/import", {
            items: part,
            rename,
            dryRun,
          })
        ).data.data as ImportResult;
        for (const key of [
          "created",
          "updated",
          "renamed",
          "unmatched",
        ] as const)
          total[key].push(...data[key]);
      }
      setResult(total);
      if (!dryRun) {
        toast(
          `Saved ${total.created.length + total.updated.length} syllabus pages.`,
          "success",
        );
        onDone();
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card staff-card staff-form">
      <h3 className="wide">
        <FileUp size={18} aria-hidden /> Import from a JSON file
      </h3>
      <p className="wide muted">
        A list of <code>{"{ code, name, markdown, credits?, subtitle? }"}</code>
        . Each item is matched to subjects by code (CS-301 also matches
        CSE-301). Importing again updates the same pages.
      </p>
      <label className="wide">
        Files
        <input
          type="file"
          accept="application/json,.json"
          multiple
          onChange={async (event) => {
            setResult(null);
            try {
              const lists = await Promise.all(
                [...(event.target.files || [])].map(async (file) => {
                  const data = JSON.parse(await file.text());
                  if (!Array.isArray(data))
                    throw new Error(`${file.name} is not a JSON list.`);
                  return data as ImportItem[];
                }),
              );
              setItems(lists.flat());
            } catch (e) {
              setItems([]);
              toast(errorMessage(e), "error");
            }
          }}
        />
      </label>
      <label className="wide">
        Subject names
        <select value={rename} onChange={(e) => setRename(e.target.value)}>
          <option value="placeholders">
            Replace placeholder names only (a name like “CE-301”)
          </option>
          <option value="all">
            Replace every matched name with the file’s name
          </option>
          <option value="none">Keep all current names</option>
        </select>
      </label>
      <div className="wide row-actions">
        <button
          type="button"
          disabled={!items.length || busy}
          onClick={() => run(true)}
        >
          Preview {items.length ? `${items.length} items` : ""}
        </button>
        <button
          type="button"
          className="button"
          disabled={!items.length || busy}
          onClick={() => run(false)}
        >
          Import
        </button>
      </div>
      {result && (
        <div className="wide notice">
          <strong>
            {result.dryRun ? "Preview – nothing saved yet." : "Imported."}
          </strong>{" "}
          New: {result.created.length} · Updated: {result.updated.length} ·
          Renamed: {result.renamed.length} · Not matched:{" "}
          {result.unmatched.length}
          {!!result.renamed.length && (
            <details>
              <summary>Renamed subjects</summary>
              <ul>
                {result.renamed.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          )}
          {!!result.unmatched.length && (
            <details>
              <summary>
                No subject with this code (add it under Branches &amp; subjects)
              </summary>
              <ul>
                {result.unmatched.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Editor({
  subject,
  syllabus,
  onDone,
}: {
  subject: Subject;
  syllabus?: AdminSyllabus;
  onDone: (saved: boolean) => void;
}) {
  const [markdown, setMarkdown] = useState(syllabus?.markdown || TEMPLATE),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="card staff-card staff-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const number = (name: string) => {
          const value = String(form.get(name) || "").trim();
          return value === "" ? undefined : Number(value);
        };
        const credits = {
          L: number("L"),
          T: number("T"),
          P: number("P"),
          total: number("total"),
        };
        setBusy(true);
        try {
          await api.put(`/admin/syllabus/${subject._id}`, {
            markdown,
            subtitle: String(form.get("subtitle") || "").trim() || undefined,
            credits: Object.values(credits).some((v) => v != null)
              ? credits
              : undefined,
            published: form.get("published") === "on",
          });
          toast("Syllabus saved.", "success");
          onDone(true);
        } catch (e) {
          toast(errorMessage(e), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="wide">
        {subject.code} · {subject.name}
      </h3>
      <label className="wide">
        Subtitle (optional)
        <input
          name="subtitle"
          maxLength={160}
          defaultValue={syllabus?.subtitle}
          placeholder="Calculus & Linear Algebra"
        />
      </label>
      {(["L", "T", "P", "total"] as const).map((key) => (
        <label key={key}>
          {key === "total" ? "Total credits" : `${key} (periods/week)`}
          <input
            name={key}
            type="number"
            min={0}
            max={key === "total" ? 40 : 20}
            defaultValue={syllabus?.credits?.[key]}
          />
        </label>
      ))}
      <div className="wide row-actions">
        <button
          type="button"
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          Write
        </button>
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          Preview
        </button>
      </div>
      {preview ? (
        <div className="wide markdown syllabus-body card">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
          >
            {markdown}
          </ReactMarkdown>
        </div>
      ) : (
        <label className="wide">
          Syllabus (Markdown: “## Unit I – Title” headings, “1.” lists)
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            required
            minLength={20}
            maxLength={60_000}
            rows={22}
            style={{ fontFamily: "var(--font-mono, monospace)" }}
          />
        </label>
      )}
      <label className="wide inline-check">
        <input
          type="checkbox"
          name="published"
          defaultChecked={syllabus?.published ?? true}
        />
        <span>Show on the site</span>
      </label>
      <div className="wide row-actions">
        <button className="button" disabled={busy}>
          Save syllabus
        </button>
        <button type="button" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function SyllabusAdmin() {
  const [editing, setEditing] = useState<Subject | null>(null),
    [filter, setFilter] = useState(""),
    [importing, setImporting] = useState(false);
  const subjects = useQuery({
    queryKey: ["admin-subjects"],
    queryFn: async () =>
      (await api.get("/admin/taxonomy/subjects")).data.data as Subject[],
  });
  const syllabi = useQuery({
    queryKey: ["admin-syllabus"],
    queryFn: async () =>
      (await api.get("/admin/syllabus")).data.data as AdminSyllabus[],
  });
  const bySubject = useMemo(
    () => new Map((syllabi.data || []).map((s) => [s.subject?._id, s])),
    [syllabi.data],
  );
  const rows = (subjects.data || [])
    .filter((s) =>
      `${s.code} ${s.name}`.toLowerCase().includes(filter.toLowerCase()),
    )
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const refresh = () => {
    void subjects.refetch();
    void syllabi.refetch();
  };
  return (
    <>
      <div className="row-actions" style={{ justifyContent: "space-between" }}>
        <h2>Syllabus</h2>
        <button className="button" onClick={() => setImporting((v) => !v)}>
          <FileUp size={16} /> {importing ? "Close import" : "Import JSON"}
        </button>
      </div>
      <p className="muted">
        {syllabi.data?.length ?? "…"} of {subjects.data?.length ?? "…"} subjects
        have a syllabus. Each one gets a public page under /syllabus, linked
        from its papers. New pages reach search engines with the next site
        build.
      </p>
      {importing && <ImportCard onDone={refresh} />}
      {editing && (
        <Editor
          key={editing._id}
          subject={editing}
          syllabus={bySubject.get(editing._id)}
          onDone={(saved) => {
            setEditing(null);
            if (saved) refresh();
          }}
        />
      )}
      <label className="staff-search" style={{ margin: "12px 0" }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by code or name"
          aria-label="Filter subjects"
        />
      </label>
      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>SUBJECT</th>
              <th>SYLLABUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((subject) => {
              const syllabus = bySubject.get(subject._id);
              return (
                <tr key={subject._id}>
                  <td>
                    {subject.code}
                    <br />
                    <small className="muted">{subject.name}</small>
                  </td>
                  <td>
                    {syllabus ? (syllabus.published ? "Live" : "Hidden") : "—"}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => setEditing(subject)}>
                        {syllabus ? "Edit" : "Add"}
                      </button>
                      {syllabus?.published && (
                        <a
                          href={`/syllabus/${syllabus.slug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                      )}
                      {syllabus && (
                        <button
                          onClick={async () => {
                            if (
                              !(await confirmDialog({
                                title: `Delete the ${subject.code} syllabus?`,
                                body: "The syllabus page is removed. To hide it for now, edit it and untick “Show on the site”.",
                                confirmLabel: "Delete",
                                danger: true,
                              }))
                            )
                              return;
                            try {
                              await api.delete(
                                `/admin/syllabus/${subject._id}`,
                              );
                              toast("Syllabus deleted.", "success");
                              refresh();
                            } catch (e) {
                              toast(errorMessage(e), "error");
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {subjects.data && !rows.length && (
          <p className="notice">No subjects match.</p>
        )}
      </div>
    </>
  );
}
