import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
import { confirmDialog } from "../../components/Feedback";
import StandardSetup from "./StandardSetup";
type TaxRecord = {
  _id: string;
  name?: string;
  slug?: string;
  code?: string;
  number?: number;
  program?: string;
  university?: string;
  subject?: string;
  branch?: string;
  semester?: string;
  order?: number;
  active?: boolean;
  scheme?: string;
};
const categories = [
  "branches",
  "semesters",
  "subjects",
  "offerings",
  "programs",
  "universities",
];
export default function Taxonomy() {
  const [category, setCategory] = useState("branches"),
    [edit, setEdit] = useState<TaxRecord | null>(null),
    [message, setMessage] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const data = useQuery({
    queryKey: ["taxonomy-admin"],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          categories.map(async (category) => [
            category,
            (await api.get(`/admin/taxonomy/${category}`)).data
              .data as TaxRecord[],
          ]),
        ),
      ),
  });
  const records: TaxRecord[] = data.data?.[category] || [];
  const name = (key: string, id?: string) =>
    data.data?.[key]?.find((r: TaxRecord) => r._id === id)?.name || "—";
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await data.refetch();
      setMessage("Taxonomy saved.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }
  return (
    <>
      <h2>Branches, semesters & subjects</h2>
      <p className="muted">
        New branch or semester? Add it in Branches / Semesters, add the subject
        in Subjects, then link them in Offerings (subject + branch + semester).
        Only offerings appear in the upload subject picker.
      </p>
      <StandardSetup onDone={() => data.refetch()} />
      <div className="tabs" style={{ flexWrap: "wrap" }}>
        {categories.map((c) => (
          <button
            key={c}
            className={category === c ? "active" : ""}
            onClick={() => {
              setCategory(c);
              setEdit(null);
              setFrom("");
              setTo("");
            }}
          >
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      {message && (
        <p className="notice" role="status" style={{ whiteSpace: "pre-line" }}>
          {message}
        </p>
      )}
      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>NAME / OFFERING</th>
              <th>CODE / URL</th>
              <th>ORDER</th>
              <th>STATE / ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => (
              <tr key={record._id}>
                <td>
                  {category === "offerings"
                    ? `${name("subjects", record.subject)} · ${name("branches", record.branch)} · ${name("semesters", record.semester)}`
                    : record.name}
                </td>
                <td>{record.code || record.slug || record.scheme || "—"}</td>
                <td>
                  {record.order ?? index}
                  <div className="row-actions">
                    <button
                      disabled={index === 0}
                      onClick={() =>
                        run(async () => {
                          const ids = records.map((r) => r._id);
                          [ids[index - 1], ids[index]] = [
                            ids[index],
                            ids[index - 1],
                          ];
                          await api.post(
                            `/admin/taxonomy/${category}/reorder`,
                            { ids },
                          );
                        })
                      }
                    >
                      Move up
                    </button>
                  </div>
                </td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => setEdit(record)}>Edit</button>
                    <button
                      onClick={() =>
                        run(() =>
                          api.delete(
                            `/admin/taxonomy/${category}/${record._id}`,
                          ),
                        )
                      }
                    >
                      Delete unused
                    </button>
                    <span>
                      {record.active === false ? "Inactive" : "Active"}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 30 }}>
        {edit ? "Edit taxonomy" : "Add taxonomy"}
      </h3>
      <form
        key={`${category}-${edit?._id}`}
        className="card staff-card staff-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget),
            payload: Record<string, unknown> = {};
          for (const [key, value] of form) {
            if (value === "") continue;
            payload[key] = ["number", "order"].includes(key)
              ? Number(value)
              : key === "active"
                ? value === "true"
                : value;
          }
          if (category === "offerings" && !edit) {
            // One offering per ticked branch: a common subject reaches every branch in one save.
            const branches = form.getAll("branch").map(String);
            if (!branches.length) {
              setMessage("Tick at least one branch.");
              return;
            }
            void (async () => {
              const results = await Promise.allSettled(
                branches.map((branch) =>
                  api.post("/admin/taxonomy/offerings", { ...payload, branch }),
                ),
              );
              await data.refetch();
              const created = results.filter(
                  (r) => r.status === "fulfilled",
                ).length,
                failed = results
                  .map((r, i) =>
                    r.status === "rejected"
                      ? `${name("branches", branches[i])}: ${errorMessage(r.reason)}`
                      : "",
                  )
                  .filter(Boolean);
              setMessage(
                [
                  `Created ${created} offering${created === 1 ? "" : "s"}.`,
                  ...failed,
                ].join("\n"),
              );
            })();
            return;
          }
          run(async () => {
            if (edit)
              await api.patch(
                `/admin/taxonomy/${category}/${edit._id}`,
                payload,
              );
            else await api.post(`/admin/taxonomy/${category}`, payload);
            setEdit(null);
          });
        }}
      >
        {category !== "offerings" && (
          <>
            <label>
              Name
              <input name="name" required defaultValue={edit?.name} />
            </label>
            <label>
              URL name
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                defaultValue={edit?.slug}
              />
            </label>
            {["subjects", "branches"].includes(category) && (
              <label>
                Subject / branch code
                <input
                  name="code"
                  required={category === "subjects"}
                  defaultValue={edit?.code}
                />
              </label>
            )}
            <label>
              Order
              <input
                type="number"
                name="order"
                defaultValue={edit?.order || 0}
              />
            </label>
            <label>
              State
              <select
                name="active"
                defaultValue={String(edit?.active !== false)}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </>
        )}
        {["branches", "semesters", "offerings"].includes(category) && (
          <label>
            Program
            <select required name="program" defaultValue={edit?.program || ""}>
              <option value="">Choose program</option>
              {data.data?.programs?.map((p: TaxRecord) => (
                <option value={p._id} key={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {category === "programs" && (
          <label>
            University
            <select
              required
              name="university"
              defaultValue={edit?.university || ""}
            >
              <option value="">Choose university</option>
              {data.data?.universities?.map((p: TaxRecord) => (
                <option value={p._id} key={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {category === "semesters" && (
          <label>
            Semester number
            <input
              required
              name="number"
              type="number"
              min={1}
              max={20}
              defaultValue={edit?.number}
            />
          </label>
        )}
        {category === "offerings" &&
          ["subjects", "branches", "semesters"].map((c) => {
            const singular = c.slice(0, -1);
            if (c === "branches" && !edit)
              return (
                <fieldset key={c} className="wide branch-checks">
                  <legend>
                    Branches · tick every branch that studies this subject in
                    this semester
                  </legend>
                  {data.data?.branches?.map((p: TaxRecord) => (
                    <label key={p._id}>
                      <input type="checkbox" name="branch" value={p._id} />
                      {p.code ? p.code + " · " : ""}
                      {p.name}
                    </label>
                  ))}
                </fieldset>
              );
            return (
              <label key={c}>
                {singular}
                <select
                  required
                  name={singular}
                  defaultValue={
                    ((edit as Record<string, unknown>)?.[singular] as string) ||
                    ""
                  }
                >
                  <option value="">Choose {singular}</option>
                  {data.data?.[c]?.map((p: TaxRecord) => (
                    <option value={p._id} key={p._id}>
                      {p.code ? p.code + " · " : ""}
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        {["subjects", "offerings"].includes(category) && (
          <label>
            Scheme (optional)
            <input name="scheme" defaultValue={edit?.scheme} />
          </label>
        )}
        <div className="wide row-actions">
          <button className="button" type="submit">
            Save taxonomy
          </button>
          {edit && (
            <button type="button" onClick={() => setEdit(null)}>
              Cancel edit
            </button>
          )}
        </div>
      </form>
      {["subjects", "branches", "semesters"].includes(category) && (
        <section className="card staff-card" style={{ marginTop: 24 }}>
          <h3>Merge duplicates</h3>
          <p>
            Content relationships move to the surviving record. The source
            becomes inactive.
          </p>
          <div className="toolbar">
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Duplicate source"
            >
              <option value="">Duplicate record</option>
              {records.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Surviving target"
            >
              <option value="">Keep this record</option>
              {records.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              className="button secondary"
              disabled={!from || !to || from === to}
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: "Merge these records?",
                    body: "Content moves to the record you keep; the duplicate becomes inactive.",
                    confirmLabel: "Merge",
                  })
                )
                  run(() =>
                    api.post(`/admin/taxonomy/${category}/merge`, { from, to }),
                  );
              }}
            >
              Merge
            </button>
          </div>
        </section>
      )}
    </>
  );
}
