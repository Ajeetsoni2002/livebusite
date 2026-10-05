import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { publicRead } from "../lib/api";
import type { Entity } from "../lib/types";
export default function SearchBox({
  large = false,
  onDone,
  autoFocus = false,
  examples = [],
}: {
  large?: boolean;
  onDone?: () => void;
  autoFocus?: boolean;
  examples?: string[];
}) {
  const [text, setText] = useState(""),
    [query, setQuery] = useState(""),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState(-1);
  const navigate = useNavigate(),
    input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [example, setExample] = useState(0);
  useEffect(() => {
    if (
      examples.length < 2 ||
      open ||
      text ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = setInterval(
      () => setExample((i) => (i + 1) % examples.length),
      4000,
    );
    return () => clearInterval(timer);
  }, [examples.length, open, text]);
  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);
  const suggestions = useQuery({
    queryKey: ["suggestions", query],
    queryFn: () => publicRead<Entity[]>("/search/suggestions", { q: query }),
    enabled: query.length >= 2,
    staleTime: 60_000,
    retry: 0,
  });
  const currentSuggestions =
    text.trim() === query ? suggestions.data?.data || [] : [];
  function search(value = text) {
    if (value.trim()) {
      navigate(`/papers?q=${encodeURIComponent(value.trim())}`);
      setOpen(false);
      onDone?.();
    }
  }
  return (
    <div className={`search-wrap ${large ? "large" : ""}`}>
      <form
        className="search-box"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <Search size={large ? 23 : 18} />
        <label className="sr-only" htmlFor={`${id}-search`}>
          Search subjects, codes or year
        </label>
        <input
          ref={input}
          id={`${id}-search`}
          autoFocus={autoFocus}
          value={text}
          maxLength={120}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setSelected(-1);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            const options = currentSuggestions;
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, options.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => (options.length ? Math.max(i - 1, 0) : -1));
            }
            if (
              e.key === "Enter" &&
              open &&
              selected >= 0 &&
              options[selected]
            ) {
              e.preventDefault();
              if (options[selected])
                search(options[selected].code || options[selected].name);
            }
          }}
          placeholder={
            examples.length
              ? `Try ${examples[example % examples.length]}…`
              : large
                ? "Subject, subject code, or exam year…"
                : "Search the library…"
          }
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && query.length >= 2}
          aria-controls={
            open && query.length >= 2 ? `${id}-suggestions` : undefined
          }
          aria-activedescendant={
            open && selected >= 0 ? `${id}-suggestion-${selected}` : undefined
          }
          autoComplete="off"
        />
        <button
          data-magnetic={large || undefined}
          className={large ? "button" : "icon-button"}
          aria-label={large ? undefined : "Search papers"}
          type="submit"
        >
          {large && <span>Find papers</span>}
          <ArrowRight size={18} />
        </button>
      </form>
      {open && query.length >= 2 && (
        <div
          className="suggestions"
          id={`${id}-suggestions`}
          aria-label="Matching subjects"
          role="listbox"
        >
          {currentSuggestions.map((s, i) => (
            <button
              type="button"
              key={s._id}
              id={`${id}-suggestion-${i}`}
              className={i === selected ? "selected" : ""}
              role="option"
              aria-selected={i === selected}
              onClick={() => search(s.code || s.name)}
            >
              <span>{s.name}</span>
              <small>{s.code}</small>
            </button>
          ))}
          {suggestions.data?.data.length === 0 && (
            <p>No subject match. Press Enter to search all resources.</p>
          )}
        </div>
      )}
    </div>
  );
}
