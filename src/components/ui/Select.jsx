// src/components/ui/Select.jsx
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export default function Select({
  options     = [],
  value       = "",
  onChange,
  placeholder = "Select an option",
  error,
  disabled    = false,
  id,
  className   = "",
  // When true, the trigger becomes a text input: typing filters the list,
  // and if nothing matches, a "+ Add “…”" option lets the typed text itself
  // become the value (e.g. team names, which aren't a fixed enum).
  creatable   = false,
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [query, setQuery] = useState("");
  const triggerRef      = useRef(null);
  const dropdownRef     = useRef(null);

  const normalised = options.map(o =>
    typeof o === "string" ? { value: o, label: o } : o
  );
  const selected = normalised.find(o => o.value === value);

  // Keep the input's displayed text in sync with the selected value
  // whenever it changes from outside (form reset, loading a record, etc.)
  // and we're not actively typing (dropdown closed). Falls back to the raw
  // value (not "") when it isn't in `options` — that's exactly the case
  // right after commitCreate below sets a brand-new value that `options`
  // doesn't know about yet, so this must not blank the input back out.
  useEffect(() => {
    if (creatable && !open) setQuery(selected ? selected.label : value || "");
  }, [creatable, open, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmedQuery = query.trim();
  const filtered = creatable && trimmedQuery
    ? normalised.filter(o => o.label.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : normalised;
  const exactMatch = normalised.find(o => o.label.toLowerCase() === trimmedQuery.toLowerCase());
  const showCreateOption = creatable && trimmedQuery !== "" && !exactMatch;

  function openDropdown() {
    if (disabled) return;
    if (!open) setRect(triggerRef.current?.getBoundingClientRect());
    setOpen(p => !p);
  }

  function commitCreate() {
    if (!trimmedQuery) return;
    onChange(trimmedQuery);
    setQuery(trimmedQuery);
    setOpen(false);
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (!triggerRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Close on scroll outside dropdown
  useEffect(() => {
    if (!open) return;
    function handleScroll(e) {
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", () => setOpen(false));
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  function handleKeyDown(e) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDropdown(); }
    if (e.key === "Escape") setOpen(false);
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      const next = normalised[normalised.findIndex(o => o.value === value) + 1];
      if (next) onChange(next.value);
    }
    if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      const prev = normalised[normalised.findIndex(o => o.value === value) - 1];
      if (prev) onChange(prev.value);
    }
  }

  function handleSelect(val, label) {
    onChange(val);
    if (creatable) setQuery(label);
    setOpen(false);
  }

  function handleInputFocus() {
    if (disabled) return;
    setRect(triggerRef.current?.getBoundingClientRect());
    setOpen(true);
  }

  function handleInputChange(e) {
    setQuery(e.target.value);
    if (!open) setRect(triggerRef.current?.getBoundingClientRect());
    setOpen(true);
  }

  function handleInputKeyDown(e) {
    if (disabled) return;
    if (e.key === "Escape") {
      setQuery(selected ? selected.label : value || "");
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (exactMatch) handleSelect(exactMatch.value, exactMatch.label);
      else if (showCreateOption) commitCreate();
    }
  }

  const dropdownStyle = rect ? {
    position: "fixed",
    top:   rect.bottom + 4,
    left:  rect.left,
    width: rect.width,
    zIndex: 99999,
  } : {};

  return (
    <>
      <div className={`csl-wrapper${className ? ` ${className}` : ""}`} style={{ position: "relative" }}>
        {creatable ? (
          <div className="csl-trigger-input-wrap">
            <input
              ref={triggerRef}
              id={id}
              type="text"
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-controls="csl-listbox"
              disabled={disabled}
              className={[
                "csl-trigger",
                "csl-trigger-input",
                error    ? "csl-trigger-error"    : "",
                open     ? "csl-trigger-open"     : "",
                disabled ? "csl-trigger-disabled" : "",
              ].filter(Boolean).join(" ")}
              placeholder={placeholder}
              value={query}
              onFocus={handleInputFocus}
              onClick={handleInputFocus}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
            />
            <span className={`csl-chevron csl-chevron-input${open ? " csl-chevron-open" : ""}`} aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        ) : (
          <button
            ref={triggerRef}
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls="csl-listbox"
            disabled={disabled}
            className={[
              "csl-trigger",
              error    ? "csl-trigger-error"    : "",
              open     ? "csl-trigger-open"     : "",
              disabled ? "csl-trigger-disabled" : "",
            ].filter(Boolean).join(" ")}
            onClick={openDropdown}
            onKeyDown={handleKeyDown}
          >
            <span className={selected ? "csl-value" : "csl-placeholder"}>
              {selected ? selected.label : placeholder}
            </span>
            <span className={`csl-chevron${open ? " csl-chevron-open" : ""}`} aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>
        )}
      </div>

      {open && rect && createPortal(
        <ul ref={dropdownRef} role="listbox" id="csl-listbox" className="csl-dropdown" style={dropdownStyle}>
          {(creatable ? filtered : normalised).map(option => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`csl-option${option.value === value ? " csl-option-selected" : ""}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleSelect(option.value, option.label)}
            >
              {option.label}
              {option.value === value && (
                <span className="csl-option-check" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
            </li>
          ))}
          {showCreateOption && (
            <li
              role="option"
              aria-selected={false}
              className="csl-option csl-option-create"
              onMouseDown={e => e.preventDefault()}
              onClick={commitCreate}
            >
              + Add &ldquo;{trimmedQuery}&rdquo;
            </li>
          )}
          {creatable && filtered.length === 0 && !showCreateOption && (
            <li className="csl-option csl-option-empty" aria-disabled="true">No matches</li>
          )}
        </ul>,
        document.body
      )}
    </>
  );
}