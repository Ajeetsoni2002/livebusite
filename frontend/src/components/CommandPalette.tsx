import { useEffect, useId, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  X,
  Search,
  ArrowUpRight,
  FileText,
  BookOpen,
  Layers,
} from "lucide-react";
import { publicRead } from "../lib/api";
import { contentPath, type ContentItem, type Entity } from "../lib/types";
import { usePublic } from "../lib/queries";

export default function CommandPalette({
  dialog,
  onClose,
}: {
  dialog: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const [text, setText] = useState(""),
    [query, setQuery] = useState(""),
    [selectedKey, setSelectedKey] = useState("");
  const navigate = useNavigate(),
    id = useId();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useQuery({
    queryKey: ["command-search", query],
    enabled: query.length >= 2,
    staleTime: 60_000,
    retry: 0,
    queryFn: async () => {
      const [papers, notes] = await Promise.all([
        publicRead<ContentItem[]>("/papers", { q: query, limit: 5 }),
        publicRead<ContentItem[]>("/notes", { q: query, limit: 5 }),
      ]);
      return { papers, notes };
    },
  });
  const branches = usePublic<Entity[]>("/branches");
  const current = text.trim() === query;
  const groups = [
    {
      name: "Papers",
      Icon: FileText,
      items: (current ? results.data?.papers.data || [] : []).map((item) => ({
        key: item._id,
        title: item.title,
        detail: String(item.year || "Paper"),
        href: contentPath(item),
      })),
    },
    {
      name: "Notes",
      Icon: BookOpen,
      items: (current ? results.data?.notes.data || [] : []).map((item) => ({
        key: item._id,
        title: item.title,
        detail: "Short note",
        href: contentPath(item, "notes"),
      })),
    },
    {
      name: "Branches",
      Icon: Layers,
      items: (branches.data?.data || [])
        .filter(
          (b) =>
            !text.trim() ||
            (b.name + " " + b.code)
              .toLowerCase()
              .includes(text.trim().toLowerCase()),
        )
        .map((b) => ({
          key: b._id,
          title: b.name,
          detail: b.code || "Branch",
          href: "/papers?branch=" + encodeURIComponent(b._id),
        })),
    },
  ];
  const options = groups.flatMap((g) => g.items);
  const selected = options.findIndex((option) => option.key === selectedKey);
  function go(href: string) {
    navigate(href);
    onClose();
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="command-modal card"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Search library"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-head">
          <div>
            <span className="eyebrow">THE WHOLE ARCHIVE, ONE SEARCH</span>
            <h2>What are you working on?</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close search"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <form
          className="command-input"
          onSubmit={(e) => {
            e.preventDefault();
            if (selected >= 0 && options[selected]) go(options[selected].href);
            else if (text.trim())
              go("/papers?q=" + encodeURIComponent(text.trim()));
          }}
        >
          <Search size={20} />
          <label className="sr-only" htmlFor={id}>
            Search subjects, codes or year
          </label>
          <input
            id={id}
            autoFocus
            maxLength={120}
            value={text}
            placeholder="Subject, code, year, or branch…"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={id + "-results"}
            aria-activedescendant={
              selected >= 0 && options[selected]
                ? id + "-option-" + selected
                : undefined
            }
            onChange={(e) => {
              setText(e.target.value);
              setSelectedKey("");
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const next =
                  e.key === "ArrowDown"
                    ? Math.min(selected + 1, options.length - 1)
                    : Math.max(selected - 1, 0);
                setSelectedKey(options[next]?.key || "");
                document
                  .getElementById(id + "-option-" + next)
                  ?.scrollIntoView({ block: "nearest" });
              }
            }}
          />
          <button
            className="icon-button"
            type="submit"
            aria-label="Search papers"
          >
            <ArrowUpRight size={20} />
          </button>
        </form>
        <div
          className="command-results"
          id={id + "-results"}
          role="listbox"
          aria-label="Library results"
        >
          {groups.map(({ name, Icon, items }) => (
            <div role="group" aria-labelledby={id + name} key={name}>
              <h3 id={id + name}>
                {name}
                <span aria-hidden="true">{items.length}</span>
              </h3>
              {items.map((item) => {
                const index = options.indexOf(item);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected === index}
                    tabIndex={-1}
                    id={id + "-option-" + index}
                    key={item.key}
                    onClick={() => go(item.href)}
                  >
                    <Icon size={18} />
                    <span>
                      {item.title}
                      <small>{item.detail}</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                );
              })}
              {!items.length && (
                <p>
                  {query.length < 2 && name !== "Branches"
                    ? "Type at least two characters to search."
                    : results.isFetching
                      ? "Searching…"
                      : results.isError && name !== "Branches"
                        ? "Search unavailable. Try again shortly."
                        : "No matching " + name.toLowerCase() + " yet."}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="command-help">
          <span>↑ ↓ to move · Enter to open</span>
          <span>Esc to close</span>
        </div>
        {(results.data?.papers.saved || results.data?.notes.saved) && (
          <p className="command-saved" role="status">
            Searching the saved library.
          </p>
        )}
      </div>
    </div>
  );
}
