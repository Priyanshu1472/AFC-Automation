import { useState } from "react";
import Select from "./Select";
import "../../styles/TeamMultiSelect.css";

// A team-scoped user (dgm/agm/srm/project_officer/associate_consultant/
// project_assistant) can now be assigned to more than one team. This reuses
// the existing creatable Select as an "add a team" picker, plus a row of
// removable chips for what's already selected — value[0] is always treated
// as the primary/home team elsewhere (create-staff-user/update-staff-user).
export default function TeamMultiSelect({ options = [], value = [], onChange, disabled = false, error }) {
  const [pending, setPending] = useState("");

  function addTeam(team) {
    const trimmed = team.trim();
    if (!trimmed || value.includes(trimmed)) {
      setPending("");
      return;
    }
    onChange([...value, trimmed]);
    setPending("");
  }

  function removeTeam(team) {
    onChange(value.filter((t) => t !== team));
  }

  const addOptions = options.filter((t) => !value.includes(t)).map((t) => ({ value: t, label: t }));

  return (
    <div className="tms-wrap">
      {value.length > 0 && (
        <div className="tms-chips">
          {value.map((team, i) => (
            <span key={team} className={`tms-chip${i === 0 ? " tms-chip-primary" : ""}`}>
              {team}
              {i === 0 && value.length > 1 && <span className="tms-chip-tag">Primary</span>}
              {!disabled && (
                <button
                  type="button"
                  className="tms-chip-remove"
                  onClick={() => removeTeam(team)}
                  aria-label={`Remove ${team}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <Select
        creatable
        options={addOptions}
        value={pending}
        onChange={addTeam}
        placeholder={value.length ? "Add another team" : "Select or type a team"}
        disabled={disabled}
        error={error}
      />
      {value.length > 1 && <p className="tms-hint">The first team added is the primary team.</p>}
    </div>
  );
}
