import { useEffect, useMemo, useRef, useState } from "react";

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}
function ChevronIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>;
}
function CheckIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;
}

function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// Prefix for a Business Partner name typed on the form that isn't in the
// list yet. The lead form sends it as manual_ba_name; create-lead/update-lead
// add it to manual_business_partners so it's listed for every later lead.
export const NEW_BP_PREFIX = "new:";
// Prefix for a BP already in manual_business_partners (empanelled before
// PMIS, so there's no BP account behind it — just a name).
export const MANUAL_BP_PREFIX = "manual:";

const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

// The full list of Business Partners (every team), always visible with a
// search box on top — rather than a closed dropdown — so whoever adds a
// lead can see at a glance who is empanelled. Two kinds are listed
// together: BPs empanelled through PMIS, and BPs added manually by name
// (empanelled before PMIS). The lead's own team's BPs are listed first.
// If the BP isn't in the list at all, typing its name in the search box
// offers to add it. Clicking the selected row again clears it.
//
// More than one BP can be picked: `value` is an array of picker values in
// the order they were picked (the first is the lead's main BP). Clicking a
// picked row again unpicks it. "Yet to be Decided" is exclusive.
//
// options: [{ value, label (organisation name), team, manual? }]
export default function BusinessPartnerPicker({ options, value = [], onChange, ownTeam, error, disabled, tbdValue, tbdLabel = "Yet to be Decided" }) {
  const [query, setQuery] = useState("");
  // Closed like a dropdown until the search box is clicked/typed in; stays
  // open while picking (several BPs can be picked) and closes on a click
  // outside or Escape.
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const sorted = useMemo(
    () => [...options].sort((a, b) => (a.team === ownTeam ? 0 : 1) - (b.team === ownTeam ? 0 : 1) || a.label.localeCompare(b.label)),
    [options, ownTeam]
  );
  const q = query.trim().toLowerCase();
  const shown = q ? sorted.filter((o) => `${o.label} ${o.team || ""}`.toLowerCase().includes(q)) : sorted;
  const teamCount = new Set(options.map((o) => o.team).filter(Boolean)).size;
  const manualCount = options.filter((o) => o.manual).length;
  const pmisCount = options.length - manualCount;

  // Typed names that are selected but not saved yet (values "new:<name>").
  const pendingNames = value.filter((v) => v.startsWith(NEW_BP_PREFIX)).map((v) => v.slice(NEW_BP_PREFIX.length));
  const typedName = query.replace(/\s+/g, " ").trim();
  const exactMatch = typedName ? options.find((o) => norm(o.label) === norm(typedName)) : null;
  const canAddTyped = typedName.length >= 2 && !exactMatch && !pendingNames.some((n) => norm(n) === norm(typedName));
  const isPicked = (v) => value.includes(v);

  function pick(v) {
    if (disabled) return;
    if (v === tbdValue) { onChange(isPicked(v) ? [] : [v]); return; }
    const rest = value.filter((x) => x !== tbdValue);
    onChange(rest.includes(v) ? rest.filter((x) => x !== v) : [...rest, v]);
  }

  function addTyped() {
    if (disabled || !canAddTyped) return;
    onChange([...value.filter((x) => x !== tbdValue), NEW_BP_PREFIX + typedName]);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={`bpp${open ? " bpp-open" : ""}${error ? " bpp-has-error" : ""}${disabled ? " bpp-disabled" : ""}`}>
      <div className="bpp-toolbar" onClick={() => { if (!disabled) { setOpen(true); inputRef.current?.focus(); } }}>
        <label className="bpp-search">
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); return; }
              // Enter would otherwise submit the whole lead form.
              if (e.key === "Enter") {
                e.preventDefault();
                if (canAddTyped) addTyped();
                else if (exactMatch) { pick(exactMatch.value); setQuery(""); }
              }
            }}
            placeholder="Search, or type a BP's name to add it…"
            disabled={disabled}
            aria-label="Search Business Partners"
            aria-expanded={open}
            aria-haspopup="listbox"
          />
        </label>
        <span className="bpp-count">
          {pmisCount} on PMIS{manualCount > 0 ? ` · ${manualCount} added manually` : ""}{teamCount > 0 ? ` · ${teamCount} team${teamCount === 1 ? "" : "s"}` : ""}
        </span>
        <button
          type="button"
          className="bpp-chevron"
          aria-label={open ? "Close the list" : "Open the list"}
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        >
          <ChevronIcon />
        </button>
      </div>

      {open && (
      <div className="bpp-panel">
      <ul className="bpp-list" role="listbox" aria-multiselectable="true" aria-label="Business Partners">
        {canAddTyped && (
          <li>
            <button type="button" className="bpp-item bpp-item-add" onClick={addTyped} disabled={disabled}>
              <span className="bpp-avatar bpp-avatar-add" aria-hidden="true">+</span>
              <span className="bpp-name" title={typedName}>Add “{typedName}” as a Business Partner</span>
              <span className="bpp-tag">Not in list</span>
            </button>
          </li>
        )}
        {pendingNames.map((pendingName) => (
          <li key={pendingName}>
            <button type="button" role="option" aria-selected className="bpp-item bpp-item-selected" onClick={() => pick(NEW_BP_PREFIX + pendingName)} disabled={disabled}>
              <span className="bpp-avatar" aria-hidden="true">{initials(pendingName)}</span>
              <span className="bpp-name" title={pendingName}>{pendingName}</span>
              <span className="bpp-tag bpp-tag-new" title="Will be added to the Manually Added BP list when this lead is saved">New · added on save</span>
              <span className="bpp-check"><CheckIcon /></span>
            </button>
          </li>
        ))}
        {tbdValue && !q && (
          <li>
            <button type="button" role="option" aria-selected={isPicked(tbdValue)} className={`bpp-item bpp-item-tbd${isPicked(tbdValue) ? " bpp-item-selected" : ""}`} onClick={() => pick(tbdValue)} disabled={disabled}>
              <span className="bpp-avatar bpp-avatar-tbd" aria-hidden="true">?</span>
              <span className="bpp-name">{tbdLabel}</span>
              <span className="bpp-check">{isPicked(tbdValue) && <CheckIcon />}</span>
            </button>
          </li>
        )}
        {shown.map((o) => {
          const selected = isPicked(o.value);
          const own = !!ownTeam && o.team === ownTeam;
          return (
            <li key={o.value}>
              <button type="button" role="option" aria-selected={selected} className={`bpp-item${selected ? " bpp-item-selected" : ""}`} onClick={() => pick(o.value)} disabled={disabled}>
                <span className="bpp-avatar" aria-hidden="true">{initials(o.label)}</span>
                <span className="bpp-name" title={o.label}>{o.label}</span>
                {o.manual && <span className="bpp-tag" title="Empanelled before PMIS, added manually by name">Added manually</span>}
                {o.team && <span className={`bpp-team${own ? " bpp-team-own" : ""}`} title={own ? (o.manual ? "Added by your team" : "Empanelled by your team") : `${o.manual ? "Added" : "Empanelled"} by ${o.team}`}>{own ? `${o.team} · Yours` : o.team}</span>}
                <span className="bpp-check">{selected && <CheckIcon />}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && !canAddTyped && (
          <li className="bpp-empty">
            {options.length || q ? `No Business Partner matches "${query.trim()}".` : "No Business Partners yet. Type a name in the search box to add one."}
          </li>
        )}
      </ul>
      <p className="bpp-hint">You can pick more than one. Not in the list? Type the name in the search box and choose “Add”.</p>
      </div>
      )}
    </div>
  );
}
