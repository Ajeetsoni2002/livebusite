import { Link } from "react-router-dom";
import { ArrowUpRight, Sparkles, PenLine } from "lucide-react";
import type { ContentItem } from "../lib/types";
import { ContentCard } from "./ui";

export default function NotesShowcase({
  notes,
  saved,
  loading,
}: {
  notes: ContentItem[];
  saved?: boolean;
  loading?: boolean;
}) {
  return (
    <section className="notes-showcase" aria-labelledby="notes-showcase-title">
      <div className="notes-showcase-copy">
        <span className="eyebrow">
          <Sparkles size={14} /> THE OTHER HALF OF PREP
        </span>
        <h2 id="notes-showcase-title">
          Small notes.
          <br />
          Big lightbulb
          <br className="desktop-only" /> moments.
        </h2>
        <p>
          A clearer explanation. A useful shortcut. The notes you wish you’d
          had, passed on to someone who needs them.
        </p>
        <Link to="/notes" className="button">
          Explore short notes <ArrowUpRight size={17} />
        </Link>
        <span className="notes-footnote">
          A LITTLE CLARITY GOES A LONG WAY.
        </span>
      </div>
      {notes.length ? (
        <div className="notes-showcase-resource">
          <ContentCard item={notes[0]} kind="notes" saved={saved} />
        </div>
      ) : (
        <div className="notebook-art">
          <div className="notebook-top">
            <PenLine size={19} />
            <span>BUIT / THE SHARED NOTEBOOK</span>
          </div>
          <div className="notebook-lines" aria-hidden="true" />
          <Sparkles className="notebook-spark" size={50} strokeWidth={1.2} />
          <h3>
            Good notes
            <br />
            deserve company.
          </h3>
          <p>
            {loading
              ? "Opening the notebook…"
              : "The first page is yours to write."}
          </p>
          <Link to="/contact" className="text-link">
            Contribute your notes <ArrowUpRight size={16} />
          </Link>
          <span className="notebook-bottom">
            STUDENT KNOWLEDGE. SHARED FORWARD.
          </span>
        </div>
      )}
    </section>
  );
}
