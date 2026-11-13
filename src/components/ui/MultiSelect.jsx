import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
// Reuses the shared csl-* dropdown/option styles from Select (App.css) for
// visual consistency, plus TeamMultiSelect's chip styles (tms-*) — but this
// is its own standalone dropdown, not a wrapped Select: a plain single-pick
// Select always closes on select, which makes checking off several people
// in a row tedious (reopen, search again, pick one, repeat). This one
// stays open across multiple checkbox toggles instead.
import "../../styles/TeamMultiSelect.css";

// A generic searchable checkbox multi-select: a row of removable chips for
// what's already picked, plus a dropdown below listing every option with a
// checkbox — toggling one leaves the dropdown open so several can be
// checked in one pass. `options` is [{ value, label, group? }]; `value` is
// the array of currently-selected values. Options are expected to already
// be sorted by group when `group` is used (see Select.jsx's identical
// convention) — a group heading is rendered once above the first option of
// each run with that group.
export default function MultiSelect({ options = [], value = [], onChange, placeholder = "Select…", disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  const selectedOptions = options.filter((o) => value.includes(o.value));

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = trimmedQuery
    ? options.filter((o) => `${o.label} ${o.group || ""}`.toLowerCase().includes(trimmedQuery))
    : options;

  function toggle(val) {
    onChange(value.includes(val) ? value.filter((v) => v !== val) : [...value, val]);
  }

  function remove(val) {
    onChange(value.filter((v) => v !== val));
  }

  function openDropdown() {
    if (disabled) return;
    setRect(triggerRef.current?.getBoundingClientRect());
    setOpen(true);
  }

  function closeDropdown() {
    setOpen(false);
    setQuery("");
  }

  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (!triggerRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target)) closeDropdown();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function handleScroll(e) {
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    const handleResize = () => setOpen(false);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  const dropdownStyle = rect
    ? { position: "fixed", top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 99999 }
    : {};

  let lastGroup;

  return (
    <div className="tms-wrap">
      {selectedOptions.length > 0 && (
        <div className="tms-chips">
          {selectedOptions.map((o) => (
            <span key={o.value} className="tms-chip">
              {o.label}
              {!disabled && (
                <button type="button" className="tms-chip-remove" onClick={() => remove(o.value)} aria-label={`Remove ${o.label}`}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="csl-wrapper" style={{ position: "relative" }}>
        <div className="csl-trigger-input-wrap">
          <input
            ref={triggerRef}
            type="text"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            disabled={disabled}
            className={[
              "csl-trigger", "csl-trigger-input",
              open     ? "csl-trigger-open"     : "",
              disabled ? "csl-trigger-disabled" : "",
            ].filter(Boolean).join(" ")}
            placeholder={placeholder}
            value={query}
            onFocus={openDropdown}
            onClick={openDropdown}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) openDropdown();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeDropdown();
            }}
          />
          <span className={`csl-chevron csl-chevron-input${open ? " csl-chevron-open" : ""}`} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>

      {open && rect && createPortal(
        <ul ref={dropdownRef} role="listbox" className="csl-dropdown" style={dropdownStyle}>
          {filtered.length === 0 && <li className="csl-option-empty" aria-disabled="true">No matches</li>}
          {filtered.flatMap((o) => {
            const showGroupHeading = o.group && o.group !== lastGroup;
            lastGroup = o.group;
            const checked = value.includes(o.value);
            const items = [];
            if (showGroupHeading) items.push(<li key={`group-${o.group}`} role="presentation" className="csl-group-heading">{o.group}</li>);
            items.push(
              <li key={o.value} role="option" aria-selected={checked}>
                <label className={`csl-option csl-option-checkbox${checked ? " csl-option-selected" : ""}`} onMouseDown={(e) => e.preventDefault()}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} />
                  <span>{o.label}</span>
                </label>
              </li>
            );
            return items;
          })}
        </ul>,
        document.body
      )}
    </div>
  );
}
