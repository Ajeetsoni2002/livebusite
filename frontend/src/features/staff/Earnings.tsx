import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { rupees } from "../../lib/earn";
import { promptDialog, toast } from "../../components/Feedback";

type Tally = { approved: number; pending: number };
type Summary = {
  rate: number;
  papers: Tally;
  notes: Tally;
  approved: number;
  pending: number;
  earned: number;
  pendingValue: number;
  paid: number;
  due: number;
};
type Payout = {
  _id: string;
  amount: number;
  note?: string;
  createdAt: string;
  paidBy?: { name: string };
};
const date = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function Totals({ data }: { data: Pick<Summary, "earned" | "paid" | "due"> }) {
  return (
    <>
      <div className="card">
        <span>Earned</span>
        <strong>{rupees(data.earned)}</strong>
      </div>
      <div className="card">
        <span>Paid</span>
        <strong>{rupees(data.paid)}</strong>
      </div>
      <div className="card is-due">
        <span>Due</span>
        <strong>{rupees(data.due)}</strong>
      </div>
    </>
  );
}

/** Contributor view: what each approved upload has earned and what has been paid. */
export function MyEarnings() {
  const query = useQuery({
    queryKey: ["my-earnings"],
    queryFn: async () =>
      (await api.get("/contributor/earnings")).data.data as Summary & {
        payouts: Payout[];
      },
  });
  const data = query.data;
  return (
    <>
      <div className="section-head">
        <h2>Your earnings.</h2>
        <Link className="button" to="/contributor/upload">
          <Upload size={16} /> Upload &amp; earn more
        </Link>
      </div>
      {query.isPending && <p role="status">Adding it up…</p>}
      {query.isError && (
        <p className="notice error">{errorMessage(query.error)}</p>
      )}
      {data && (
        <>
          <p>
            You earn <strong>{rupees(data.rate)}</strong> for every approved
            paper and every approved note.
          </p>
          <div className="eh-earn-total">
            <div className="card">
              <span>Approved uploads</span>
              <strong>{data.approved}</strong>
              <small className="muted">
                {data.papers.approved} papers · {data.notes.approved} notes
              </small>
            </div>
            <Totals data={data} />
          </div>
          {data.pending > 0 && (
            <p className="notice" role="status">
              {data.pending} upload{data.pending === 1 ? " is" : "s are"}{" "}
              waiting for review — worth {rupees(data.pendingValue)} once
              approved.
            </p>
          )}
          <section className="card staff-card">
            <h3>Payments received</h3>
            {data.payouts.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>DATE</th>
                      <th>AMOUNT</th>
                      <th>NOTE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payouts.map((p) => (
                      <tr key={p._id}>
                        <td>{date.format(new Date(p.createdAt))}</td>
                        <td>{rupees(p.amount)}</td>
                        <td>{p.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">
                No payments yet. Approved uploads keep adding to what is due.
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}

type Row = Summary & { _id: string; name: string; email: string };

/** Admin view: every contributor's earnings, with a way to record a payment. */
export function Payouts() {
  const [history, setHistory] = useState<{ name: string; rows: Payout[] }>();
  const query = useQuery({
    queryKey: ["admin-earnings"],
    queryFn: async () =>
      (await api.get("/admin/earnings")).data.data as {
        rate: number;
        rows: Row[];
        totals: Pick<Summary, "earned" | "paid" | "due">;
      },
  });
  async function pay(row: Row) {
    const value = await promptDialog({
      title: `Record a payment to ${row.name}`,
      body: `${rupees(row.due)} is due. Enter the amount you paid and, optionally, a reference after a space (e.g. "50 UPI 4821").`,
      confirmLabel: "Record payment",
      input: { label: "Amount and reference", placeholder: String(row.due) },
    });
    if (value === null) return;
    const [first, ...rest] = String(value || row.due)
      .trim()
      .split(/\s+/);
    const amount = Number(first);
    if (!Number.isInteger(amount) || amount < 1) {
      toast("Enter the amount as a whole number of rupees.", "error");
      return;
    }
    try {
      await api.post(`/admin/earnings/${row._id}/payouts`, {
        amount,
        ...(rest.length ? { note: rest.join(" ") } : {}),
      });
      toast(`Recorded ${rupees(amount)} paid to ${row.name}.`, "success");
      await query.refetch();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }
  async function showHistory(row: Row) {
    try {
      const rows = (await api.get(`/admin/earnings/${row._id}/payouts`)).data
        .data as Payout[];
      setHistory({ name: row.name, rows });
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }
  const data = query.data;
  return (
    <>
      <h2>Contributor payouts.</h2>
      {query.isPending && <p role="status">Adding it up…</p>}
      {query.isError && (
        <p className="notice error">{errorMessage(query.error)}</p>
      )}
      {data && (
        <>
          <p>
            Contributors earn {rupees(data.rate)} for each approved (published)
            paper or note. Deleting or unpublishing an upload removes its
            earning.
          </p>
          <div className="eh-earn-total">
            <Totals data={data.totals} />
          </div>
          <div className="card table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>CONTRIBUTOR</th>
                  <th>APPROVED</th>
                  <th>PENDING</th>
                  <th>EARNED</th>
                  <th>PAID</th>
                  <th>DUE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row._id}>
                    <td>
                      {row.name}
                      <br />
                      <small className="muted">{row.email}</small>
                    </td>
                    <td>
                      {row.approved}
                      <br />
                      <small className="muted">
                        {row.papers.approved} papers · {row.notes.approved}{" "}
                        notes
                      </small>
                    </td>
                    <td>{row.pending}</td>
                    <td>{rupees(row.earned)}</td>
                    <td>{rupees(row.paid)}</td>
                    <td>
                      <strong>{rupees(row.due)}</strong>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button disabled={!row.due} onClick={() => pay(row)}>
                          Mark paid
                        </button>
                        <button onClick={() => showHistory(row)}>
                          History
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && <p className="muted">No contributors yet.</p>}
          </div>
          {history && (
            <section className="card staff-card" style={{ marginTop: 24 }}>
              <h3>Payments to {history.name}</h3>
              {history.rows.length ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>DATE</th>
                      <th>AMOUNT</th>
                      <th>NOTE</th>
                      <th>RECORDED BY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.rows.map((p) => (
                      <tr key={p._id}>
                        <td>{date.format(new Date(p.createdAt))}</td>
                        <td>{rupees(p.amount)}</td>
                        <td>{p.note || "—"}</td>
                        <td>{p.paidBy?.name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">No payments recorded yet.</p>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
