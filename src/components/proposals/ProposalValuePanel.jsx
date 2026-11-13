// "Financial" — the total value AFC proposed to the client. Saved on the
// proposal itself via set_proposal_proposed_value() (allowed until the
// proposal is locked, even after the submission deadline). Required before
// locking, and becomes the starting contract value in Monitoring once the
// proposal is awarded.
import { useState } from "react";
import { supabase } from "../../lib/supabase";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { RupeeIcon, PencilIcon } from "../icons";
import { formatINR, fmtDate } from "../../lib/monitoring";

export default function ProposalValuePanel({ proposal, canManage, onChanged }) {
  const value = proposal.proposed_value;
  const editableNow = canManage && !proposal.locked;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function startEdit() {
    setDraft(value != null ? String(value) : "");
    setError("");
    setEditing(true);
  }

  async function save(e) {
    e.preventDefault();
    const n = Number(draft);
    if (!draft || !Number.isFinite(n) || n <= 0) { setError("Enter the total proposed value in rupees."); return; }
    setSaving(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc("set_proposal_proposed_value", { p_proposal_id: proposal.id, p_value: n });
    setSaving(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setEditing(false);
    onChanged();
  }

  const showForm = editableNow && (editing || value == null);

  return (
    <Card>
      <Collapsible title="Financial" subtitle="Total value proposed to the client." icon={<RupeeIcon />} expandable={false}>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        {showForm ? (
          <form className="pp-value-form" onSubmit={save}>
            <label className="field-label" htmlFor="pp-proposed-value">Total proposed value (₹)</label>
            <div className="pp-value-form-row">
              <div className="pp-value-input">
                <span aria-hidden="true">₹</span>
                <input
                  id="pp-proposed-value"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 2500000"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={saving}
                  autoFocus={editing}
                />
              </div>
              <Button type="submit" loading={saving}>Save</Button>
              {editing && value != null && <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
            {draft && Number(draft) > 0 && <span className="field-hint">{formatINR(draft)}</span>}
          </form>
        ) : value != null ? (
          <div className="pp-value-display">
            <div>
              <div className="pp-value-amount">{formatINR(value)}</div>
              {proposal.proposed_value_updated_at && (
                <div className="pp-value-meta">Last updated {fmtDate(proposal.proposed_value_updated_at)}</div>
              )}
            </div>
            {editableNow && <Button variant="secondary" size="sm" icon={<PencilIcon />} onClick={startEdit}>Edit</Button>}
          </div>
        ) : (
          <p className="pp-docs-empty">Not entered.</p>
        )}
      </Collapsible>
    </Card>
  );
}
