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

// The full list of empanelled Business Partners (every team), always
// visible with a search box on top — rather than a closed dropdown — so
// whoever adds a lead can see at a glance who is empanelled. The lead's own
// team's BPs are listed first. Clicking the selected row again clears it.
//
// options: [{ value, label (organisation name), team }]
export default function BusinessPartnerPicker({ options, value, onChange, ownTeam, error, disabled, tbdValue, tbdLabel = "Yet to be Decided" }) {
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () => [...options].sort((a, b) => (a.team === ownTeam ? 0 : 1) - (b.team === ownTeam ? 0 : 1) || a.label.localeCompare(b.label)),
    [options, ownTeam]
  );
  const q = query.trim().toLowerCase();
  const shown = q ? sorted.filter((o) => `${o.label} ${o.team || ""}`.toLowerCase().includes(q)) : sorted;
  const teamCount = new Set(options.map((o) => o.team).filter(Boolean)).size;

  function pick(v) {
    if (disabled) return;
    onChange(v === value ? "" : v);
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
            placeholder="Search by organisation or team…"
            disabled={disabled}
            aria-label="Search Business Partners"
          />
        </label>
        <span className="bpp-count">
          {options.length} empanelled{teamCount > 0 ? ` · ${teamCount} team${teamCount === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      <ul className="bpp-list" role="listbox" aria-label="Empanelled Business Partners">
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
                {o.team && <span className={`bpp-team${own ? " bpp-team-own" : ""}`} title={own ? "Empanelled by your team" : `Empanelled by ${o.team}`}>{own ? `${o.team} · Yours` : o.team}</span>}
                <span className="bpp-check">{selected && <CheckIcon />}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="bpp-empty">
            {options.length ? `No Business Partner matches "${query.trim()}".` : "No empanelled Business Partners yet."}
          </li>
        )}
      </ul>
    </div>
  );
}
