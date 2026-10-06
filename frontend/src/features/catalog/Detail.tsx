import { lazy, Suspense, useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Eye, Flag, ArrowLeft, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { usePublic } from "../../lib/queries";
import { api, errorMessage } from "../../lib/api";
import { usePageMeta } from "../../lib/meta";
import type { ContentItem } from "../../lib/types";
import { ContentCard, SavedNotice, Skeleton } from "../../components/ui";
import { track } from "../../lib/analytics";
import { PdfThumbnail } from "../../components/PdfThumbnail";
import { downloadResource } from "../../lib/download";
import { wake } from "../../lib/wake";
const PdfViewer = lazy(() => import("../../components/PdfViewer"));
export default function Detail({ kind = "papers" }: { kind?: string }) {
  const { slug } = useParams(),
    item = usePublic<ContentItem>(`/${kind}/${slug}`),
    related = usePublic<ContentItem[]>(
      `/papers/${item.data?.data._id}/related`,
      {},
      kind === "papers" && !!item.data?.data && !item.data.saved,
    );
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [report, setReport] = useState(false);
  const data = item.data?.data;
  usePageMeta(data?.title || "Resource");
  async function download() {
    if (!data) return;
    setBusy(true);
    setMessage("");
    try {
      await downloadResource(data._id, kind);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => wake(), []);
  useEffect(() => {
    if (data && !item.data?.saved)
      track({ kind: "contentview", contentType: kind, contentId: data._id });
  }, [data?._id, item.data?.saved, kind]);
  if (item.isPending)
    return (
      <main className="page">
        <p role="status">Connecting to the library…</p>
        <Skeleton count={3} />
      </main>
    );
  if (!data)
    return (
      <main className="page">
        <h1>Resource unavailable</h1>
        <p>{errorMessage(item.error)}</p>
        <Link to={`/${kind}`} className="button">
          Back to the library
        </Link>
      </main>
    );
  const offering = data.offerings[0];
  return (
    <main
      className={`page detail-page ${kind === "notes" ? "note-detail" : ""}`}
    >
      <Link to={`/${kind}`} className="text-link">
        <ArrowLeft size={16} /> Back to {kind}
      </Link>
      {item.data?.saved && <SavedNotice />}
      <div className="detail-layout">
        <article className="detail-main">
          <div className="page-heading">
            <div className="eyebrow">
              {offering?.subject.code || "RESOURCE"}
            </div>
            <h1>{offering?.subject.name || data.title}</h1>
            <p>
              {kind === "papers"
                ? `${data.year || "Year unverified"} · ${data.session || "Session unverified"}`
                : data.title}
            </p>
            <div className="detail-context">
              <span>{offering?.branch.code || "Student archive"}</span>
              <span>{offering?.semester.name || "Open resource"}</span>
              <span>{kind === "notes" ? "SHORT NOTE" : "QUESTION PAPER"}</span>
            </div>
          </div>
          {data.format !== "markdown" && (
            <div className="detail-mobile-actions">
              <button
                className="button full"
                disabled={busy || item.data?.saved}
                onClick={download}
              >
                <Download size={18} />
                {busy ? "Preparing…" : "Download PDF"}
              </button>
            </div>
          )}
          <div className="preview card">
            {data.format === "markdown" ? (
              <div className="markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSanitize]}
                >
                  {data.markdown || ""}
                </ReactMarkdown>
              </div>
            ) : preview && !item.data?.saved ? (
              <Suspense fallback={<p role="status">Loading preview…</p>}>
                <PdfViewer
                  kind={kind}
                  id={data._id}
                  title={data.title}
                  onDownload={download}
                />
              </Suspense>
            ) : (
              <div className="preview-placeholder">
                <span className="eyebrow">THE READING ROOM</span>
                <PdfThumbnail
                  key={`${kind}/${data._id}/${data.updatedAt || ""}/${data.hasThumbnail}`}
                  id={data._id}
                  kind={kind}
                  available={data.hasThumbnail}
                  large
                />
                <h2>A page closer to prepared.</h2>
                <p>Read here, or take a copy with you.</p>
                <button
                  className="button secondary"
                  disabled={item.data?.saved}
                  onClick={() => setPreview(true)}
                >
                  <Eye size={17} /> Open preview
                </button>
              </div>
            )}
          </div>
          {message && (
            <p className="notice error" role="alert">
              {message}
            </p>
          )}
        </article>
        <aside className="detail-sidebar card">
          <span className="pill">
            {kind === "papers" ? "QUESTION PAPER" : "SHORT NOTE"}
          </span>
          <h2>The paper trail.</h2>
          <dl>
            {[
              ["Subject code", offering?.subject.code],
              ["Branch", offering?.branch.name],
              ["Semester", offering?.semester.name],
              [
                "Exam type",
                data.examType === "Unknown" ? "Unverified" : data.examType,
              ],
              ["Unit / topic", data.unit || data.topic],
              [
                "Contributed by",
                data.author?.name || data.credit || "Legacy student archive",
              ],
              ["Download actions", String(data.downloads)],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {data.format !== "markdown" && (
            <button
              className="button full"
              disabled={busy || item.data?.saved}
              onClick={download}
            >
              <Download size={18} />
              {busy ? "Preparing…" : "Download PDF"}
            </button>
          )}
          <button className="text-link" onClick={() => setReport((v) => !v)}>
            <Flag size={14} /> Report an issue
          </button>
          {report && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const input = new FormData(e.currentTarget);
                  await api.post("/reports", {
                    message: String(input.get("message")),
                    content: data._id,
                    contentType: kind,
                  });
                  setMessage(
                    "Thank you. The library team will review this report.",
                  );
                  setReport(false);
                } catch (error) {
                  setMessage(errorMessage(error));
                }
              }}
            >
              <label>
                What needs fixing?
                <textarea
                  name="message"
                  minLength={10}
                  maxLength={2000}
                  required
                />
              </label>
              <button className="button secondary">Send report</button>
            </form>
          )}
          {offering && (
            <Link
              className="text-link"
              to={`/subjects/${offering.program.slug}/${offering.branch.slug}/sem-${offering.semester.number}/${offering.subject.slug}?tab=${kind === "papers" ? "notes" : "papers"}`}
            >
              See subject {kind === "papers" ? "notes" : "papers"}{" "}
              <ExternalLink size={14} />
            </Link>
          )}
        </aside>
      </div>
      {related.data?.data.length ? (
        <section className="library-section">
          <div className="section-head">
            <h2>Same subject, another year.</h2>
          </div>
          <div className="content-grid">
            {related.data.data.map((p) => (
              <ContentCard key={p._id} item={p} saved={related.data?.saved} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
