// Lets the lead's own Person Responsible, Reviewer, or Recommending
// Authority (or MD/Admin) add another team member to the lead — that
// person then gets the exact same lead access as the Person Responsible
// (server-side via can_view_lead() plus every pipeline action's own
// isPr()-style check, widened in 20261125010000_lead_additional_
// responsibles.sql). The add/remove calls go through edge functions so
// the lead's chat roster and a notification stay in sync — see
// add-lead-responsible/remove-lead-responsible. Near-duplicate of
// Proposals' AdditionalResponsiblesPanel.jsx, one pipeline stage earlier.
import { useState, useEffect } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Button from "../ui/Button";
import Select from "../ui/Select";
import Alert from "../ui/Alert";
import { withActiveCounts, personOption } from "../../lib/personActivityCounts";
import { CloseIcon } from "../icons";

// The "add" control is an icon button the parent puts beside the Person
// Responsible label, so the picker is controlled via adding/onAddingChange.
export default function LeadAdditionalResponsiblesPanel({ leadId, team, existingIds, additional, canManage, disabled, onChanged, adding, onAddingChange }) {
  const setAdding = onAddingChange;
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!adding || !team) return;
    (async () => {
      const excludeIds = new Set([...existingIds, ...additional.map((a) => a.user_id)].filter(Boolean));
      const { data } = await supabase
        .from("afc_users")
        .select("id, full_name")
        .eq("team", team)
        .eq("is_active", true)
        .not("role", "in", "(business_associate,agm,srm,dgm,general_manager)")
        .order("full_name");
      const candidates = (data || []).filter((u) => !excludeIds.has(u.id));
      const withCounts = await withActiveCounts(candidates);
      setOptions(withCounts.map(personOption));
    })();
  }, [adding, team, existingIds, additional]);

  async function handleAdd() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("add-lead-responsible", { body: { lead_id: leadId, user_id: selected } });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to add. Try again.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to add. Try again."); return; }
      setSelected("");
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(err.message || "Failed to add. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(userId) {
    setRemovingId(userId);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("remove-lead-responsible", { body: { lead_id: leadId, user_id: userId } });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to remove. Try again.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to remove. Try again."); return; }
      onChanged();
    } catch (err) {
      setError(err.message || "Failed to remove. Try again.");
    } finally {
      setRemovingId(null);
    }
  }

  if (additional.length === 0 && !(canManage && !disabled && adding) && !error) return null;

  return (
    <div className="pp-additional-pr">
      {additional.length > 0 && (
        <div className="pp-additional-pr-list">
          {additional.map((a) => (
            <span key={a.user_id} className="pp-additional-pr-chip">
              {a.full_name}
              {canManage && !disabled && (
                <button
                  type="button"
                  className="pp-additional-pr-remove"
                  title={`Remove ${a.full_name}`}
                  disabled={removingId === a.user_id}
                  onClick={() => handleRemove(a.user_id)}
                >
                  <CloseIcon />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {canManage && !disabled && adding && (
        <div className="pp-additional-pr-add-row">
          <Select searchable options={options} value={selected} onChange={setSelected} placeholder="Add another Person Responsible…" />
          <Button size="sm" loading={busy} disabled={!selected} onClick={handleAdd}>Add</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setAdding(false); setSelected(""); setError(""); }}>Cancel</Button>
        </div>
      )}

      {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
    </div>
  );
}
