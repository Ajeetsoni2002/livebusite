import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListChecks, Loader2 } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { confirmDialog, toast } from "../../components/Feedback";

type Plan = {
  program: string;
  branches: string[];
  semesters: number[];
  subjects: string[];
  renamed: { from: string; to: string }[];
  merged: { from: string; to: string }[];
  offerings: number;
  shared: number;
};

const sample = (list: string[]) =>
  list.length > 12
    ? `${list.slice(0, 12).join(", ")} … +${list.length - 12} more`
    : list.join(", ");

/** One click: every branch gets its full B.Tech subject list in the upload picker. */
export default function StandardSetup({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (dryRun: boolean) =>
    api.post(
      "/admin/taxonomy/standard-setup",
      { dryRun },
      { timeout: 120_000 },
    );
  async function preview() {
    setBusy(true);
    try {
      setPlan((await run(true)).data.data);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (
      !plan ||
      !(await confirmDialog({
        title: "Add the standard subjects?",
        body: "Only missing items are added. Existing subjects, papers and links are kept.",
        confirmLabel: "Add subjects",
      }))
    )
      return;
    setBusy(true);
    try {
      const done: Plan = (await run(false)).data.data;
      toast(
        `Added ${done.subjects.length} subjects and ${done.offerings} links; ${done.shared} first-year item(s) now show in every branch.`,
        "success",
      );
      setPlan(null);
      onDone();
      await client.invalidateQueries();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  const nothing =
    plan &&
    !plan.branches.length &&
    !plan.semesters.length &&
    !plan.subjects.length &&
    !plan.renamed.length &&
    !plan.merged.length &&
    !plan.offerings &&
    !plan.shared;
  return (
    <section className="card staff-card settings-card standard-setup">
      <h3>
        <ListChecks size={18} /> Standard B.Tech subjects
      </h3>
      <p className="muted">
        Semesters 1–2 use BE-101…105 and BE-201…205 for every branch. Semesters
        3–8 use each branch’s own codes (CSE-301…305 up to CE-801…805) for CSE,
        IT, ECE, ME, EE and CE. First-year papers and notes show in every
        branch. New subjects are named by their code; rename them below whenever
        you like.
      </p>
      {plan && (
        <ul className="plan-list">
          {nothing ? (
            <li>Everything is already set up.</li>
          ) : (
            <>
              {plan.branches.length > 0 && (
                <li>New branches: {plan.branches.join(", ")}</li>
              )}
              {plan.semesters.length > 0 && (
                <li>New semesters: {plan.semesters.join(", ")}</li>
              )}
              {plan.renamed.length > 0 && (
                <li>
                  Renamed (old code kept as alias, links unchanged):{" "}
                  {plan.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}
                </li>
              )}
              {plan.merged.length > 0 && (
                <li>
                  Merged duplicates (papers move along):{" "}
                  {plan.merged.map((r) => `${r.from} → ${r.to}`).join(", ")}
                </li>
              )}
              {plan.subjects.length > 0 && (
                <li>
                  {plan.subjects.length} new subjects: {sample(plan.subjects)}
                </li>
              )}
              {plan.offerings > 0 && (
                <li>
                  {plan.offerings} new branch/semester links for the upload
                  picker
                </li>
              )}
              {plan.shared > 0 && (
                <li>
                  {plan.shared} first-year paper(s)/note(s) will show in every
                  branch
                </li>
              )}
            </>
          )}
        </ul>
      )}
      <div className="row-actions">
        <button onClick={preview} disabled={busy}>
          {busy && !plan ? <Loader2 className="spin" size={15} /> : null}{" "}
          Preview changes
        </button>
        {plan && !nothing && (
          <button className="studio-primary" onClick={apply} disabled={busy}>
            {busy ? <Loader2 className="spin" size={15} /> : null} Add subjects
          </button>
        )}
      </div>
    </section>
  );
}
