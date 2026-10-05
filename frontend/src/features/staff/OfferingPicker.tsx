import { useId, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { Offering } from "../../lib/types";
import AddOffering from "./AddOffering";

export const offeringLabel = (o: Offering) =>
  `${o.branch.code || o.branch.name} · ${o.semester.name} · ${o.subject.code} · ${o.subject.name}`;

// Checkbox picker so one PDF can belong to several branch/semester offerings.
export default function OfferingPicker({
  options,
  value,
  onChange,
  label,
  name,
  onCreate,
}: {
  options: Offering[];
  value: string[];
  onChange: (ids: string[]) => void;
  label: string;
  name?: string;
  /** Admin only: lets the picker create a missing branch / semester / subject. */
  onCreate?: (offering: Offering) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [adding, setAdding] = useState(false),
    panelId = useId();
  const byId = useMemo(
    () => new Map(options.map((o) => [o._id, o])),
    [options],
  );
  const shown = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((o) => {
      const text = offeringLabel(o).toLowerCase();
      return terms.every((t) => text.includes(t));
    });
  }, [options, query]);
  const selected = new Set(value);
  const toggle = (id: string) =>
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  const allShown = shown.length > 0 && shown.every((o) => selected.has(o._id));

  return (
    <div className="offering-picker">
      {name &&
        value.map((id) => (
          <input key={id} type="hidden" name={name} value={id} />
        ))}
      <button
        type="button"
        className="offering-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          {value.length === 0
            ? "Choose subject / branch / semester"
            : value.length === 1 && byId.has(value[0])
              ? offeringLabel(byId.get(value[0])!)
              : `${value.length} branch/semester offering${value.length > 1 ? "s" : ""} selected`}
        </span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {value.length > 1 && (
        <div className="offering-chips">
          {value.map((id) => {
            const o = byId.get(id);
            if (!o) return null;
            return (
              <span key={id} className="offering-chip">
                {o.branch.code || o.branch.name} · {o.semester.name} ·{" "}
                {o.subject.code}
                <button
                  type="button"
                  aria-label={`Remove ${offeringLabel(o)}`}
                  onClick={() => toggle(id)}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {open && (
        <div className="offering-panel" id={panelId}>
          <input
            type="search"
            autoFocus
            placeholder="Search code, subject, branch… e.g. 101 or maths"
            aria-label={`Search ${label}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter") e.preventDefault();
            }}
          />
          <div className="row-actions">
            <button
              type="button"
              disabled={!shown.length}
              onClick={() =>
                onChange(
                  allShown
                    ? value.filter((id) => !shown.some((o) => o._id === id))
                    : [...new Set([...value, ...shown.map((o) => o._id)])],
                )
              }
            >
              {allShown
                ? "Unselect shown"
                : `Select all shown (${shown.length})`}
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
          <div className="offering-list" role="group" aria-label={label}>
            {shown.map((o) => (
              <label key={o._id}>
                <input
                  type="checkbox"
                  checked={selected.has(o._id)}
                  onChange={() => toggle(o._id)}
                />
                {offeringLabel(o)}
              </label>
            ))}
            {!shown.length && <p className="muted">No matching offering.</p>}
          </div>
          {onCreate &&
            (adding ? (
              <AddOffering
                onCancel={() => setAdding(false)}
                onCreated={(offering) => {
                  onCreate(offering);
                  if (!selected.has(offering._id))
                    onChange([...value, offering._id]);
                  setAdding(false);
                  setQuery("");
                }}
              />
            ) : (
              <div className="row-actions">
                <button type="button" onClick={() => setAdding(true)}>
                  + Not in the list? Add branch / semester / subject
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
