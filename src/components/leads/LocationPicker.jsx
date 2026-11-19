import { useRef, useState } from "react";
import MultiSelect from "../ui/MultiSelect";
import { INDIAN_STATES } from "../../lib/portal_table";
import "../../styles/TeamMultiSelect.css";
import "../../styles/LocationPicker.css";

// Lead "State / Location" field — the standard checkbox MultiSelect with:
//   • "Pan India" at the top (mutually exclusive with individual states)
//   • every state/UT as a checkbox
//   • "Others (outside India)" at the bottom, which opens a text box + Add
//     button to type places one at a time
// Chips for everything picked sit BELOW the field, so the input stays level
// with its neighbour in the two-column row.
// Value shape: { selected: string[], others: string[], showOther: bool }.
// Saved into the single leads.state text column via serializeLocation —
// e.g. "Pan India", "Bihar, Gujarat", "Bihar, Dubai".

export const PAN_INDIA = "Pan India";
const OTHER = "__other__";
const KNOWN = new Set([PAN_INDIA, ...INDIAN_STATES]);
const OPTIONS = [
  { value: PAN_INDIA, label: PAN_INDIA, group: "Nationwide" },
  ...INDIAN_STATES.map((s) => ({ value: s, label: s, group: "States / UTs" })),
  { value: OTHER, label: "Others (outside India)", group: "International" },
];

export function parseLocation(raw) {
  const parts = (raw || "").split(",").map((p) => p.trim()).filter(Boolean);
  const others = parts.filter((p) => !KNOWN.has(p));
  return { selected: parts.filter((p) => KNOWN.has(p)), others, showOther: others.length > 0 };
}

export function serializeLocation(v) {
  return [...v.selected, ...v.others].join(", ");
}

export function isLocationEmpty(v) {
  return v.selected.length === 0 && v.others.length === 0;
}

export default function LocationPicker({ value, onChange, error, disabled = false }) {
  const [draft, setDraft] = useState("");
  const otherInputRef = useRef(null);
  const { selected, others, showOther } = value;

  function handleChange(next) {
    const prev = [...selected, ...(showOther ? [OTHER] : [])];
    const added = next.find((v) => !prev.includes(v));
    let sel = next.filter((v) => v !== OTHER);
    // Pan India and individual states exclude each other.
    if (added === PAN_INDIA) sel = [PAN_INDIA];
    else if (added && added !== OTHER) sel = sel.filter((v) => v !== PAN_INDIA);
    const nowOther = next.includes(OTHER);
    onChange({ selected: sel, showOther: nowOther, others: nowOther ? others : [] });
    if (!nowOther) setDraft("");
    if (added === OTHER) setTimeout(() => otherInputRef.current?.focus(), 0);
  }

  function addOther() {
    const name = draft.trim();
    if (!name) return;
    if (!others.some((o) => o.toLowerCase() === name.toLowerCase())) onChange({ ...value, others: [...others, name] });
    setDraft("");
  }

  const chips = [
    ...selected.map((s) => ({ key: s, label: s, remove: () => onChange({ ...value, selected: selected.filter((x) => x !== s) }) })),
    ...others.map((o) => ({ key: `o:${o}`, label: o, other: true, remove: () => onChange({ ...value, others: others.filter((x) => x !== o) }) })),
  ];

  return (
    <div className="lp">
      <MultiSelect
        options={OPTIONS}
        value={[...selected, ...(showOther ? [OTHER] : [])]}
        onChange={handleChange}
        placeholder="Select state(s), Pan India or Others"
        disabled={disabled}
        error={!!error}
        hideChips
      />

      {showOther && (
        <div className="lp-other">
          <input
            ref={otherInputRef}
            type="text"
            className="input"
            value={draft}
            maxLength={150}
            disabled={disabled}
            placeholder="Type a place outside India, e.g. Dubai"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOther(); } }}
            // Typed but never added (e.g. went straight to Save) — keep it rather than lose it.
            onBlur={addOther}
          />
          <button type="button" className="btn btn-primary lp-add" onMouseDown={(e) => e.preventDefault()} onClick={addOther} disabled={disabled || !draft.trim()}>
            Add
          </button>
        </div>
      )}

      {chips.length > 0 && (
        <div className="tms-chips">
          {chips.map((c) => (
            <span key={c.key} className={`tms-chip${c.other ? " lp-chip-other" : ""}`}>
              {c.label}
              {!disabled && (
                <button type="button" className="tms-chip-remove" onClick={c.remove} aria-label={`Remove ${c.label}`}>×</button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
