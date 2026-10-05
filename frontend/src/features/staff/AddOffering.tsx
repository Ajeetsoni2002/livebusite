import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
import type { Entity, Offering } from "../../lib/types";

const NEW = "__new__";
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const list = async (name: string) =>
  (await api.get(`/admin/taxonomy/${name}`)).data.data as Entity[];
type Link = { _id: string; subject: string; branch: string; semester: string };

// Admin-only: create a missing branch / semester / subject and link them, without leaving the upload form.
export default function AddOffering({
  onCreated,
  onCancel,
}: {
  onCreated: (offering: Offering) => void;
  onCancel: () => void;
}) {
  const tax = useQuery({
    queryKey: ["add-offering-taxonomy"],
    queryFn: async () => {
      const [programs, branches, semesters, subjects] = await Promise.all(
        ["programs", "branches", "semesters", "subjects"].map(list),
      );
      return { programs, branches, semesters, subjects };
    },
  });
  const [program, setProgram] = useState(""),
    [branch, setBranch] = useState(""),
    [semester, setSemester] = useState(""),
    [subject, setSubject] = useState(""),
    [fields, setFields] = useState({
      branchName: "",
      branchCode: "",
      semesterNumber: "",
      subjectCode: "",
      subjectName: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (tax.isPending) return <p className="muted">Loading branches…</p>;
  if (tax.isError)
    return <p className="notice error">{errorMessage(tax.error)}</p>;
  const data = tax.data,
    programId = program || data.programs[0]?._id || "",
    inProgram = <T extends Entity>(rows: T[]) =>
      rows.filter((r) => r.program === programId),
    set = (key: keyof typeof fields) => (e: { target: { value: string } }) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));

  async function create() {
    setBusy(true);
    setError("");
    try {
      if (!programId) throw new Error("Create a program first.");
      if (!branch || !semester || !subject)
        throw new Error("Choose or add a branch, semester and subject.");
      const post = async (name: string, body: object) =>
        (await api.post(`/admin/taxonomy/${name}`, body)).data.data as Entity;
      const programRecord = data.programs.find((p) => p._id === programId)!;
      let branchRecord = data.branches.find((b) => b._id === branch);
      if (branch === NEW) {
        const code = fields.branchCode.trim().toUpperCase(),
          name = fields.branchName.trim();
        if (!code || name.length < 2)
          throw new Error("Enter the new branch name and code.");
        branchRecord = await post("branches", {
          name,
          code,
          slug: slug(code),
          program: programId,
          order: data.branches.length,
        });
      }
      let semesterRecord = data.semesters.find((s) => s._id === semester);
      if (semester === NEW) {
        const number = Number(fields.semesterNumber);
        if (!Number.isInteger(number) || number < 1 || number > 20)
          throw new Error("Semester number must be 1 to 20.");
        semesterRecord = await post("semesters", {
          name: `Semester ${number}`,
          slug: `sem-${number}`,
          number,
          program: programId,
          order: number,
        });
      }
      let subjectRecord = data.subjects.find((s) => s._id === subject);
      if (subject === NEW) {
        const code = fields.subjectCode.trim().toUpperCase(),
          name = fields.subjectName.trim();
        if (!code || name.length < 2)
          throw new Error("Enter the new subject code and name.");
        subjectRecord = await post("subjects", {
          name,
          code,
          slug: slug(code),
        });
      }
      const link = {
        subject: subjectRecord!._id,
        branch: branchRecord!._id,
        semester: semesterRecord!._id,
        program: programId,
      };
      let offeringId: string;
      try {
        offeringId = (await post("offerings", link))._id;
      } catch (e) {
        // Already linked: reuse the existing offering instead of failing.
        const existing = (
          (await api.get("/admin/taxonomy/offerings")).data.data as Link[]
        ).find(
          (o) =>
            o.subject === link.subject &&
            o.branch === link.branch &&
            o.semester === link.semester,
        );
        if (!existing) throw e;
        offeringId = existing._id;
      }
      await tax.refetch();
      onCreated({
        _id: offeringId,
        subject: subjectRecord!,
        branch: branchRecord!,
        semester: semesterRecord!,
        program: programRecord,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-offering">
      <strong>Add a branch / semester / subject</strong>
      {data.programs.length > 1 && (
        <label>
          Program
          <select
            value={programId}
            onChange={(e) => setProgram(e.target.value)}
          >
            {data.programs.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Branch
        <select value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">Choose branch</option>
          {inProgram(data.branches).map((b) => (
            <option key={b._id} value={b._id}>
              {b.code ? `${b.code} · ` : ""}
              {b.name}
            </option>
          ))}
          <option value={NEW}>+ New branch…</option>
        </select>
      </label>
      {branch === NEW && (
        <div className="add-offering-pair">
          <input
            aria-label="New branch code"
            placeholder="Code, e.g. IT"
            value={fields.branchCode}
            onChange={set("branchCode")}
          />
          <input
            aria-label="New branch name"
            placeholder="Name, e.g. Information Technology"
            value={fields.branchName}
            onChange={set("branchName")}
          />
        </div>
      )}
      <label>
        Semester
        <select value={semester} onChange={(e) => setSemester(e.target.value)}>
          <option value="">Choose semester</option>
          {inProgram(data.semesters).map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
          <option value={NEW}>+ New semester…</option>
        </select>
      </label>
      {semester === NEW && (
        <input
          aria-label="New semester number"
          type="number"
          min={1}
          max={20}
          placeholder="Semester number"
          value={fields.semesterNumber}
          onChange={set("semesterNumber")}
        />
      )}
      <label>
        Subject
        <select value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">Choose existing subject</option>
          <option value={NEW}>+ New subject…</option>
          {data.subjects.map((s) => (
            <option key={s._id} value={s._id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
      </label>
      {subject === NEW && (
        <div className="add-offering-pair">
          <input
            aria-label="New subject code"
            placeholder="Code, e.g. IT-101"
            value={fields.subjectCode}
            onChange={set("subjectCode")}
          />
          <input
            aria-label="New subject name"
            placeholder="Name, e.g. Engineering Mathematics-I"
            value={fields.subjectName}
            onChange={set("subjectName")}
          />
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        <button type="button" disabled={busy} onClick={create}>
          {busy ? "Saving…" : "Create & select"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
