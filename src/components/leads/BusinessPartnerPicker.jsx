import { useMemo, useState } from "react";

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
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
// options: [{ value, label (organisation name), team, manual? }]
export default function BusinessPartnerPicker({ options, value, onChange, ownTeam, error, disabled, tbdValue, tbdLabel = "Yet to be Decided" }) {
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () => [...options].sort((a, b) => (a.team === ownTeam ? 0 : 1) - (b.team === ownTeam ? 0 : 1) || a.label.localeCompare(b.label)),
    [options, ownTeam]
  );
  const q = query.trim().toLowerCase();
  const shown = q ? sorted.filter((o) => `${o.label} ${o.team || ""}`.toLowerCase().includes(q)) : sorted;
  const teamCount = new Set(options.map((o) => o.team).filter(Boolean)).size;
  const manualCount = options.filter((o) => o.manual).length;
  const pmisCount = options.length - manualCount;

  // A typed name that's selected but not saved yet (value "new:<name>").
  const pendingName = value?.startsWith(NEW_BP_PREFIX) ? value.slice(NEW_BP_PREFIX.length) : "";
  const typedName = query.replace(/\s+/g, " ").trim();
  const exactMatch = typedName ? options.find((o) => norm(o.label) === norm(typedName)) : null;
  const canAddTyped = typedName.length >= 2 && !exactMatch && norm(pendingName) !== norm(typedName);

  function pick(v) {
    if (disabled) return;
    onChange(v === value ? "" : v);
  }

  function addTyped() {
    if (disabled || !canAddTyped) return;
    onChange(NEW_BP_PREFIX + typedName);
    setQuery("");
  }

  return (
    <div className={`bpp${error ? " bpp-has-error" : ""}${disabled ? " bpp-disabled" : ""}`}>
      <div className="bpp-toolbar">
        <label className="bpp-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
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
          />
        </label>
        <span className="bpp-count">
          {pmisCount} on PMIS{manualCount > 0 ? ` · ${manualCount} added manually` : ""}{teamCount > 0 ? ` · ${teamCount} team${teamCount === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      <ul className="bpp-list" role="listbox" aria-label="Business Partners">
        {canAddTyped && (
          <li>
            <button type="button" className="bpp-item bpp-item-add" onClick={addTyped} disabled={disabled}>
              <span className="bpp-avatar bpp-avatar-add" aria-hidden="true">+</span>
              <span className="bpp-name" title={typedName}>Add “{typedName}” as a Business Partner</span>
              <span className="bpp-tag">Not in list</span>
            </button>
          </li>
        )}
        {pendingName && (
          <li>
            <button type="button" role="option" aria-selected className="bpp-item bpp-item-selected" onClick={() => pick(value)} disabled={disabled}>
              <span className="bpp-avatar" aria-hidden="true">{initials(pendingName)}</span>
              <span className="bpp-name" title={pendingName}>{pendingName}</span>
              <span className="bpp-tag bpp-tag-new" title="Will be added to the Manually Added BP list when this lead is saved">New · added on save</span>
              <span className="bpp-check"><CheckIcon /></span>
            </button>
          </li>
        )}
        {tbdValue && !q && (
          <li>
            <button type="button" role="option" aria-selected={value === tbdValue} className={`bpp-item bpp-item-tbd${value === tbdValue ? " bpp-item-selected" : ""}`} onClick={() => pick(tbdValue)} disabled={disabled}>
              <span className="bpp-avatar bpp-avatar-tbd" aria-hidden="true">?</span>
              <span className="bpp-name">{tbdLabel}</span>
              <span className="bpp-check">{value === tbdValue && <CheckIcon />}</span>
            </button>
          </li>
        )}
        {shown.map((o) => {
          const selected = o.value === value;
          const own = !!ownTeam && o.team === ownTeam;
          return (
            <li key={o.value}>
              <button type="button" role="option" aria-selected={selected} className={`bpp-item${selected ? " bpp-item-selected" : ""}`} onClick={() => pick(o.value)} disabled={disabled}>
                <span className="bpp-avatar" aria-hidden="true">{initials(o.label)}</span>
                <span className="bpp-name" title={o.label}>{o.label}</span>
                {o.manual && <span className="bpp-tag" title="Empanelled before PMIS — added manually by name">Added manually</span>}
                {o.team && <span className={`bpp-team${own ? " bpp-team-own" : ""}`} title={own ? (o.manual ? "Added by your team" : "Empanelled by your team") : `${o.manual ? "Added" : "Empanelled"} by ${o.team}`}>{own ? `${o.team} · Yours` : o.team}</span>}
                <span className="bpp-check">{selected && <CheckIcon />}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && !canAddTyped && (
          <li className="bpp-empty">
            {options.length || q ? `No Business Partner matches "${query.trim()}".` : "No Business Partners yet — type a name in the search box to add one."}
          </li>
        )}
      </ul>
      <p className="bpp-hint">Not in the list? Type the Business Partner's name in the search box and choose “Add”.</p>
    </div>
  );
}
