import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Mail, MessageCircle, UserPlus, X } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { confirmDialog, promptDialog, toast } from "../../components/Feedback";

type Request = {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  branch?: string;
  semester?: number;
  institution?: string;
  message: string;
  existingAccount?: boolean;
  status: "open" | "approved" | "rejected";
  note?: string;
  createdAt: string;
};
type Approved = { request: Request; password: string };

const loginUrl = () => `${location.origin}/contributor/login`;
const welcome = ({ request, password }: Approved) =>
  `Hi ${request.name.split(" ")[0]}, your BUIT Papers contributor account is ready.\n\n` +
  `Sign in: ${loginUrl()}\nEmail: ${request.email}\nTemporary password: ${password}\n\n` +
  `You will be asked to choose your own password on first sign-in. Thank you for sharing papers!`;

/** Shows the one-time password with ready-to-send email/WhatsApp messages. */
function Credentials({
  value,
  onClose,
}: {
  value: Approved;
  onClose: () => void;
}) {
  const text = welcome(value);
  const phone = (value.request.phone || "").replace(/[^\d]/g, "");
  const whatsapp = phone ? (phone.length === 10 ? `91${phone}` : phone) : "";
  return (
    <div className="card staff-card credentials" role="alert">
      <strong>
        <Check size={16} /> Account created for {value.request.name}
      </strong>
      <p className="muted">
        This password is shown only once. Send it now; they will set their own
        password on first sign-in.
      </p>
      <code className="credentials-box">
        {value.request.email}
        <br />
        {value.password}
      </code>
      <div className="row-actions">
        <a
          className="pdf-tool-link"
          href={`mailto:${value.request.email}?subject=${encodeURIComponent("Your BUIT Papers contributor account")}&body=${encodeURIComponent(text)}`}
        >
          <Mail size={15} /> Send by email
        </a>
        {whatsapp && (
          <a
            className="pdf-tool-link"
            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={15} /> Send on WhatsApp
          </a>
        )}
        <button
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => toast("Message copied.", "success"))
              .catch(() =>
                toast("Copy failed; select the text instead.", "error"),
              )
          }
        >
          <Copy size={15} /> Copy message
        </button>
        <button onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default function ContributorRequests({
  onApproved,
}: {
  onApproved: () => void;
}) {
  const [status, setStatus] = useState<"open" | "approved" | "rejected">(
    "open",
  );
  const [approved, setApproved] = useState<Approved | null>(null);
  const top = useRef<HTMLElement>(null);
  const query = useQuery({
    queryKey: ["contributor-requests", status],
    queryFn: async () =>
      (await api.get("/admin/contributor-requests", { params: { status } }))
        .data.data as Request[],
  });
  async function approve(request: Request) {
    if (
      !(await confirmDialog({
        title: `Create a contributor account for ${request.name}?`,
        body: `A temporary password is generated for ${request.email}. Their uploads go to moderation first.`,
        confirmLabel: "Approve",
      }))
    )
      return;
    try {
      const result = (
        await api.post(`/admin/contributor-requests/${request._id}/approve`, {})
      ).data.data;
      setApproved({ request, password: result.temporaryPassword });
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      await query.refetch();
      onApproved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function reject(request: Request) {
    const note = await promptDialog({
      title: `Decline ${request.name}'s request?`,
      body: "Optional note for your records.",
      confirmLabel: "Decline",
      danger: true,
      input: { label: "Note", placeholder: "e.g. duplicate request" },
    });
    if (note === null) return;
    try {
      await api.post(`/admin/contributor-requests/${request._id}/reject`, {
        note: note || undefined,
      });
      toast("Request declined.", "success");
      await query.refetch();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  const rows = query.data || [];
  return (
    <section className="requests" ref={top} aria-labelledby="requests-title">
      <div className="section-head">
        <h3 id="requests-title">
          <UserPlus size={18} /> Account requests
          {status === "open" && rows.length > 0 && (
            <span className="count-badge">{rows.length}</span>
          )}
        </h3>
        <div className="tabs" role="group" aria-label="Request status">
          {(["open", "approved", "rejected"] as const).map((s) => (
            <button
              key={s}
              className={status === s ? "active" : ""}
              onClick={() => setStatus(s)}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {approved && (
        <Credentials value={approved} onClose={() => setApproved(null)} />
      )}
      {query.isError && (
        <p className="notice error">{errorMessage(query.error)}</p>
      )}
      {!query.isPending && !rows.length && (
        <p className="muted">
          {status === "open"
            ? "No pending requests. Students can ask for access at /contribute."
            : "Nothing here yet."}
        </p>
      )}
      <div className="request-list">
        {rows.map((request) => (
          <article key={request._id} className="card request-card">
            <header>
              <strong>{request.name}</strong>
              <span className="muted">
                {new Date(request.createdAt).toLocaleDateString()}
              </span>
            </header>
            <p className="request-meta">
              <a href={`mailto:${request.email}`}>{request.email}</a>
              {request.phone && <> · {request.phone}</>}
              {request.branch && <> · {request.branch}</>}
              {request.semester && <> · Semester {request.semester}</>}
              {request.institution && <> · {request.institution}</>}
            </p>
            <p className="request-message">{request.message}</p>
            {request.existingAccount && (
              <p className="notice">This email already has an account.</p>
            )}
            {request.note && <p className="muted">Note: {request.note}</p>}
            {request.status === "open" && (
              <div className="row-actions">
                <button onClick={() => approve(request)}>
                  <Check size={15} /> Approve & create account
                </button>
                <button onClick={() => reject(request)}>
                  <X size={15} /> Decline
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
