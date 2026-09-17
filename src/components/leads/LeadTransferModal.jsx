// Standalone "Transfer Lead" modal for PMT/org-wide roles — moves a lead
// to a different team via transfer-lead, independent of a cross-team query
// existing (see LeadQueryPanel for the query-triggered path, which uses
// the same underlying transfer-lead logic through respond-lead-query).
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useTeamOptions } from "../../hooks/useTeamOptions";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import Select from "../ui/Select";
import PinInput from "../ui/PinInput";

export default function LeadTransferModal({ leadId, currentTeam, onClose, onSuccess }) {
  const teams = useTeamOptions();
  const teamOptions = teams.filter((t) => t !== currentTeam).map((t) => ({ value: t, label: t }));

  const [targetTeam, setTargetTeam] = useState("");
  const [justification, setJustification] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!targetTeam) { setError("Select a target team."); return; }
    if (!justification.trim()) { setError("A justification is required."); return; }
    if (!/^\d{4}$/.test(pin)) { setError("Enter your 4-digit PIN."); return; }
    setSaving(true);
    setError("");
    try {
      const { data, error: err } = await supabase.functions.invoke("transfer-lead", {
        body: { lead_id: leadId, target_team: targetTeam, justification: justification.trim(), pin },
      });
      if (err) { setError(await extractFunctionErrorMessage(err, "Failed to transfer lead.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to transfer lead."); return; }
      onSuccess();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={!saving ? onClose : undefined} closeOnBackdrop={!saving}>
      <Modal.Header
        title="Transfer Lead"
        subtitle="The lead moves to the new team at pa_review — they'll pick their own Person Responsible, Reviewer, Recommending Authority, and Business Partner, and the approval note process restarts."
        onClose={!saving ? onClose : undefined}
      />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        <div className="field">
          <label className="field-label">Target Team <span className="required">*</span></label>
          <Select options={teamOptions} value={targetTeam} onChange={setTargetTeam} placeholder="Select a team" disabled={saving} />
        </div>

        <div className="field" style={{ marginTop: "var(--space-3)" }}>
          <label className="field-label">Justification <span className="required">*</span></label>
          <textarea className="input" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why is this lead being transferred?" />
        </div>

        <div className="field" style={{ marginTop: "var(--space-3)" }}>
          <PinInput
            label="Your Action PIN"
            required
            value={pin}
            onChange={setPin}
            disabled={saving}
            hint="Confirms it's really you"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={saving || !targetTeam || !justification.trim() || pin.length !== 4} onClick={handleConfirm}>
          Transfer Lead
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
