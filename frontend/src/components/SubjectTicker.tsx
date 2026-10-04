import { useState } from "react";
import { Pause, Play, Sparkles } from "lucide-react";
import type { ContentItem } from "../lib/types";
export default function SubjectTicker({ papers }: { papers: ContentItem[] }) {
  const [paused, setPaused] = useState(false);
  const subjects = [
    ...new Map(
      papers.flatMap((p) =>
        p.offerings.map((o) => [o.subject._id, o.subject] as const),
      ),
    ).values(),
  ];
  if (!subjects.length) return null;
  return (
    <section
      className={`subject-ticker ${paused ? "is-paused" : ""}`}
      aria-label="Subjects in the archive"
    >
      <div className="ticker-label">
        IN GOOD COMPANY
        <button
          className="icon-button"
          aria-label={paused ? "Play subject ticker" : "Pause subject ticker"}
          aria-pressed={paused}
          onClick={() => setPaused((v) => !v)}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      </div>
      <div className="ticker-window" tabIndex={0}>
        <div className="ticker-track">
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1 ? true : undefined}>
              {subjects.map((subject) => (
                <li key={subject._id}>
                  <Sparkles size={16} />
                  <span>{subject.name}</span>
                  <small>{subject.code}</small>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
