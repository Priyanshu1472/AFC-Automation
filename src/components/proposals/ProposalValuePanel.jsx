// "Financial" — the total value AFC proposed to the client. Saved on the
// proposal itself via set_proposal_proposed_value() (allowed until the
// proposal is locked, even after the submission deadline). A project award
// carries it into Monitoring as the starting contract value.
//
// Whether it's needed before locking depends on the proposal
// (proposedValueRule):
//   RFP / Suo Moto     required
//   EOI                optional — an EOI often has no price
//   Empanelment only   none — the team ticks "Empanelment only" here
//                      (set_proposal_empanelment_only, which also clears any
//                      value already entered)
import { useState } from "react";
import { supabase } from "../../lib/supabase";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import Badge from "../ui/Badge";
import ConfirmDialog from "../ui/ConfirmDialog";
import { RupeeIcon, PencilIcon } from "../icons";
import { formatINR, fmtDate } from "../../lib/monitoring";

export default function ProposalValuePanel({ bare = false, proposal, canManage, valueRule, defaultOpen = true, onChanged }) {
  const value = proposal.proposed_value;
  const editableNow = canManage && !proposal.locked;
  const empanelmentOnly = !!proposal.empanelment_only;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmEmpanelment, setConfirmEmpanelment] = useState(false);

  function startEdit() {
    setDraft(value != null ? String(value) : "");
    setError("");
    setEditing(true);
  }

  async function saveValue(next) {
    setSaving(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc("set_proposal_proposed_value", { p_proposal_id: proposal.id, p_value: next });
    setSaving(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setEditing(false);
    onChanged();
  }

  function save(e) {
    e.preventDefault();
    const n = Number(draft);
    if (!draft || !Number.isFinite(n) || n <= 0) { setError("Enter the total proposed value in rupees."); return; }
    saveValue(n);
  }

  async function setEmpanelment(on) {
    setSaving(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc("set_proposal_empanelment_only", { p_proposal_id: proposal.id, p_on: on });
    setSaving(false);
    setConfirmEmpanelment(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setEditing(false);
    onChanged();
  }

  function toggleEmpanelment() {
    if (!empanelmentOnly && value != null) { setConfirmEmpanelment(true); return; }
    setEmpanelment(!empanelmentOnly);
  }

  const showForm = editableNow && !empanelmentOnly && (editing || value == null);
  const ruleBadge = valueRule === "none"
    ? <Badge variant="neutral">Not applicable</Badge>
    : valueRule === "optional"
      ? <Badge variant="neutral">Optional for EOI</Badge>
      : value == null ? <Badge variant="warning">Required</Badge> : null;

  return (
    <Card className={bare ? "pp-bare" : ""}>
      <Collapsible expandable={!bare} title="Financial" icon={<RupeeIcon />} action={ruleBadge} defaultOpen={defaultOpen}>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        {empanelmentOnly ? (
          <p className="pp-value-note">This tender is for empanelment only, so there is no proposed value.</p>
        ) : showForm ? (
          <form className="pp-value-form" onSubmit={save}>
            <label className="field-label" htmlFor="pp-proposed-value">
              Total proposed value (₹){valueRule === "optional" && <span className="pp-value-optional"> — optional for an EOI</span>}
            </label>
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
            {editableNow && (
              <div className="pp-value-actions">
                {valueRule === "optional" && (
                  <Button variant="ghost" size="sm" disabled={saving} onClick={() => saveValue(null)}>Remove</Button>
                )}
                <Button variant="secondary" size="sm" icon={<PencilIcon />} onClick={startEdit}>Edit</Button>
              </div>
            )}
          </div>
        ) : (
          <p className="pp-docs-empty">{valueRule === "optional" ? "No proposed value (optional for an EOI)." : "Not entered."}</p>
        )}

        {editableNow && (
          <label className="pp-value-check">
            <input type="checkbox" checked={empanelmentOnly} disabled={saving} onChange={toggleEmpanelment} />
            <span>
              <strong>Empanelment only</strong>
              <small>This tender only empanels the firm; there is no proposed value.</small>
            </span>
          </label>
        )}
      </Collapsible>

      {confirmEmpanelment && (
        <ConfirmDialog
          title="Mark as Empanelment only?"
          message={`The proposed value of ${formatINR(value)} will be removed.`}
          confirmLabel="Mark Empanelment only"
          loading={saving}
          onConfirm={() => setEmpanelment(true)}
          onCancel={() => setConfirmEmpanelment(false)}
        />
      )}
    </Card>
  );
}
