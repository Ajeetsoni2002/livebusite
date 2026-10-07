import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { Mail, ArrowUpRight } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { usePageMeta } from "../lib/meta";
import CreatorLink from "../components/CreatorLink";
export default function Info({ page }: { page: string }) {
  const [params] = useSearchParams(),
    [message, setMessage] = useState("");
  const email = import.meta.env.VITE_CONTACT_EMAIL;
  const titles: Record<string, string> = {
    about: "Built together. Passed forward.",
    privacy: "A library that respects your privacy.",
    copyright: "Copyright & takedown",
    contact: "Help us fill the gaps.",
  };
  usePageMeta(
    titles[page] || "Page not found",
    page === "about"
      ? "Meet Ajeet Kumar Soni and the student community behind the unofficial BUIT question paper and notes archive."
      : undefined,
  );
  return (
    <main className="page info-page">
      <div className="page-heading">
        <div className="eyebrow">BUIT · BARKATULLAH UNIVERSITY</div>
        <h1>{titles[page] || "Page not found"}</h1>
      </div>
      {!titles[page] && (
        <div className="missing-page card">
          <span aria-hidden="true">404</span>
          <p>
            This page may have moved. There’s still plenty to discover in the
            archive.
          </p>
          <Link className="button" to="/papers">
            Back to the papers <ArrowUpRight size={17} />
          </Link>
        </div>
      )}
      {page === "about" && (
        <>
          <p>
            This unofficial resource was created by Ajeet Kumar Soni and team to
            help Barkatullah University students find previous year question
            papers. We preserve the existing student archive and the
            contributions that made it possible.
          </p>
          <section className="card prose story-creator">
            <div className="eyebrow">
              OUR STORY / THE STUDENT BEHIND THE ARCHIVE
            </div>
            <h2>A little help for the next batch.</h2>
            <p>
              Finding the right paper should be the easy part of preparing for
              an exam. Ajeet Kumar Soni built this library to bring past papers
              and student contributions into one place, organized by branch,
              semester and subject.
            </p>
            <p>
              The archive grows with the students who share their resources.
              Have a missing paper or useful notes? Help the next batch by
              getting in touch.
            </p>
            <div className="story-links">
              <CreatorLink />
              <Link to="/contact" className="text-link">
                Contribute to the archive <ArrowUpRight size={15} />
              </Link>
            </div>
          </section>
          <section className="card prose">
            <h2>With gratitude to our community</h2>
            <p>
              The original site credits faculty guidance from Divakar Singh,
              Madhav Chaturvedi, Kavita Chourasia, Jagriti Chand, Neha Lidoriya,
              Amit Jha, Hari Singh Jatav and Pooja. These are historical source
              credits, rather than a current staff directory.
            </p>
            <p>
              Our existing team, contributor photographs and event records
              remain preserved in the original archive.
            </p>
          </section>
        </>
      )}
      {page === "privacy" && (
        <div className="card prose">
          <p>
            We count daily visitors using a daily changing salted hash. Visitor
            analytics do not store raw IP addresses. We respect Do-Not-Track,
            filter recognized bots and exclude signed-in staff from visitor
            reports.
          </p>
          <p>
            Temporary analytics events expire after seven days. Staff account
            information is used to manage contributions. Contact details
            submitted with reports or requests are visible only to
            administrators.
          </p>
          <p>
            We use essential cookies for staff authentication and request
            protection. We do not carry over the original site’s advertising or
            session-recording integrations.
          </p>
        </div>
      )}
      {page === "copyright" && (
        <div className="card prose">
          <p>
            Question papers and submitted notes may remain the intellectual
            property of their respective owners. This student resource does not
            claim university affiliation or ownership of uploaded material.
          </p>
          <p>
            For a takedown request, include the resource URL, your relationship
            to the rights holder and the material that should be removed.
          </p>
          {email ? (
            <a className="button secondary" href={`mailto:${email}`}>
              <Mail size={17} />
              {email}
            </a>
          ) : (
            <p className="notice">
              The site owner must configure the takedown contact email before
              production launch. You can also submit a report from the resource
              page.
            </p>
          )}
        </div>
      )}
      {page === "contact" && (
        <div className="contact-grid">
          <div>
            <p>
              Request a missing paper, flag a problem, or ask the team about
              contributing your notes.
            </p>
            {email && (
              <a className="text-link" href={`mailto:${email}`}>
                <Mail size={17} />
                {email}
              </a>
            )}
            <p className="muted">
              Have papers to share regularly?{" "}
              <Link to="/contribute">Request a contributor account</Link>.
            </p>
          </div>
          <form
            className="card"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget,
                values = new FormData(form);
              try {
                await api.post(
                  values.get("type") === "request"
                    ? "/paper-requests"
                    : "/reports",
                  {
                    message: String(values.get("message")),
                    email: String(values.get("email") || ""),
                  },
                );
                setMessage("Thank you. Your message is in the team’s inbox.");
                form.reset();
              } catch (error) {
                setMessage(errorMessage(error));
              }
            }}
          >
            <label>
              How can we help?
              <select
                name="type"
                defaultValue={params.has("request") ? "request" : "report"}
              >
                <option value="request">Request a paper</option>
                <option value="report">Report / contributor enquiry</option>
              </select>
            </label>
            <label>
              Your email (optional)
              <input name="email" type="email" maxLength={254} />
            </label>
            <label>
              Tell us the branch, subject code and year
              <textarea
                name="message"
                required
                minLength={10}
                maxLength={2000}
                rows={5}
              />
            </label>
            <button className="button">
              Send to the team <ArrowUpRight size={17} />
            </button>
            {message && <p role="status">{message}</p>}
          </form>
        </div>
      )}
    </main>
  );
}
