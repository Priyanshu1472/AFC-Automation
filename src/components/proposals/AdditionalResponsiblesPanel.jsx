// Lets the lead's own Person Responsible, Reviewer, or Recommending
// Authority (or MD/Admin, same canManage flag the rest of the page uses)
// add another team member to the proposal — that person then gets the
// exact same proposal access as the Person Responsible (server-side via
// can_edit_proposal()/can_view_lead(), widened in
// 20261112000000_proposal_additional_responsibles). The add/remove calls
// go through edge functions so the proposal's chat roster and a
// notification stay in sync — see add-proposal-responsible/
// remove-proposal-responsible.
import { useState, useEffect } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Button from "../ui/Button";
import Select from "../ui/Select";
import Alert from "../ui/Alert";
import { withActiveCounts, personOption } from "../../lib/personActivityCounts";
import { UserPlusIcon, CloseIcon } from "../icons";

export default function AdditionalResponsiblesPanel({ leadId, team, existingIds, additional, canManage, locked, onChanged }) {
  const [adding, setAdding] = useState(false);
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
      const { data, error: fnError } = await supabase.functions.invoke("add-proposal-responsible", { body: { lead_id: leadId, user_id: selected } });
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
      const { data, error: fnError } = await supabase.functions.invoke("remove-proposal-responsible", { body: { lead_id: leadId, user_id: userId } });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to remove. Try again.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to remove. Try again."); return; }
      onChanged();
    } catch (err) {
      setError(err.message || "Failed to remove. Try again.");
    } finally {
      setRemovingId(null);
    }
  }

  if (!canManage && additional.length === 0) return null;

  return (
    <div className="pp-additional-pr">
      {additional.length > 0 && (
        <div className="pp-additional-pr-list">
          {additional.map((a) => (
            <span key={a.user_id} className="pp-additional-pr-chip">
              {a.full_name}
              {canManage && !locked && (
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

      {canManage && !locked && (
        adding ? (
          <div className="pp-additional-pr-add-row">
            <Select searchable options={options} value={selected} onChange={setSelected} placeholder="Select a team member…" />
            <Button size="sm" loading={busy} disabled={!selected} onClick={handleAdd}>Add</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setAdding(false); setSelected(""); setError(""); }}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" icon={<UserPlusIcon />} onClick={() => setAdding(true)}>Add Person Responsible</Button>
        )
      )}

      {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
    </div>
  );
}
