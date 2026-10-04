import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
type Contributor = {
  _id: string;
  name: string;
  email: string;
  active: boolean;
  trusted: boolean;
  papers: number;
  notes: number;
};
export default function Contributors() {
  const [message, setMessage] = useState(""),
    [history, setHistory] = useState<{ title: string; status: string }[]>([]),
    query = useQuery({
      queryKey: ["contributors"],
      queryFn: async () =>
        (await api.get("/admin/contributors")).data.data as Contributor[],
    });
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await query.refetch();
      setMessage("Contributor settings saved.");
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }
  return (
    <>
      <h2>The people behind the papers.</h2>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>CONTRIBUTOR</th>
              <th>UPLOADS</th>
              <th>STATE</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.map((user) => (
              <tr key={user._id}>
                <td>
                  {user.name}
                  <br />
                  <small className="muted">{user.email}</small>
                </td>
                <td>
                  {user.papers} papers · {user.notes} notes
                </td>
                <td>
                  {user.active ? "Active" : "Inactive"}
                  <br />
                  {user.trusted
                    ? "Trusted auto-publish"
                    : "Requires moderation"}
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      onClick={() =>
                        run(() =>
                          api.patch(`/admin/contributors/${user._id}`, {
                            active: !user.active,
                          }),
                        )
                      }
                    >
                      {user.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            user.trusted
                              ? "Require review again?"
                              : "Allow this contributor to publish automatically?",
                          )
                        )
                          run(() =>
                            api.patch(`/admin/contributors/${user._id}`, {
                              trusted: !user.trusted,
                            }),
                          );
                      }}
                    >
                      Toggle trust
                    </button>
                    <button
                      onClick={() => {
                        const password = prompt(
                          "New temporary password · at least 12 characters",
                        );
                        if (password)
                          run(() =>
                            api.post(
                              `/admin/contributors/${user._id}/reset-password`,
                              { temporaryPassword: password },
                            ),
                          );
                      }}
                    >
                      Reset password
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          const data = (
                            await api.get(
                              `/admin/contributors/${user._id}/history`,
                            )
                          ).data.data;
                          setHistory([...data.papers, ...data.notes]);
                        } catch (e) {
                          setMessage(errorMessage(e));
                        }
                      }}
                    >
                      History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 30 }}>Create contributor account</h3>
      <form
        className="card staff-card staff-form"
        onSubmit={(event) => {
          event.preventDefault();
          const element = event.currentTarget,
            form = new FormData(element);
          run(async () => {
            await api.post("/admin/contributors", {
              name: String(form.get("name")),
              email: String(form.get("email")),
              temporaryPassword: String(form.get("password")),
            });
            element.reset();
          });
        }}
      >
        <label>
          Name
          <input required name="name" minLength={2} />
        </label>
        <label>
          Email
          <input name="email" required type="email" />
        </label>
        <label className="wide">
          Temporary password · share securely with the contributor
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={72}
            autoComplete="new-password"
          />
        </label>
        <p className="wide muted">
          The account must change this password before contributing. Every
          upload requires moderation by default.
        </p>
        <button className="button">Create contributor</button>
      </form>
      {history.length > 0 && (
        <section className="card staff-card" style={{ marginTop: 25 }}>
          <h3>Upload history</h3>
          {history.map((item, i) => (
            <p key={i}>
              {item.title}{" "}
              <span className={`status ${item.status}`}>{item.status}</span>
            </p>
          ))}
        </section>
      )}
    </>
  );
}
