// Remark modal for sending a fee note back to whoever prepared it —
// Recommending Authority sending back to Person Responsible (no PIN,
// mirrors the Lead workflow's ra_decline exception: sending something back
// isn't itself a decision) and the MD's own send-back (PIN required, same
// as MD approve/reject elsewhere).
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PinInput from "../../components/ui/PinInput";

const ACTION_META = {
  ra_send_back: {
    title: "Send Back to Person Responsible",
    requirePin: false,
    run: (feeNoteId, remark) => supabase.functions.invoke("advance-fee-note-stage", { body: { fee_note_id: feeNoteId, action: "ra_send_back", remark } }),
  },
  md_reject: {
    title: "Send Back to Person Responsible",
    requirePin: true,
    run: (feeNoteId, remark, pin) => supabase.functions.invoke("decide-fee-note-md", { body: { fee_note_id: feeNoteId, decision: "rejected", remark, pin } }),
  },
};

export default function FeeNoteSendBackModal({ feeNoteId, action, onClose, onSuccess }) {
  const meta = ACTION_META[action];
  const [remark, setRemark] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!remark.trim()) { setError("A remark is required."); return; }
    if (meta.requirePin && !/^\d{4}$/.test(pin)) { setError("Enter your 4-digit PIN."); return; }
    setSaving(true);
    setError("");
    try {
      const { data, error: err } = await meta.run(feeNoteId, remark.trim(), pin);
      if (err) { setError(await extractFunctionErrorMessage(err, "Action failed.")); return; }
      if (!data?.success) { setError(data?.error || "Action failed."); return; }
      onSuccess();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={!saving ? onClose : undefined} closeOnBackdrop={!saving}>
      <Modal.Header title={meta.title} subtitle="This note goes back to draft so it can be edited and re-forwarded." onClose={!saving ? onClose : undefined} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        <div className="field">
          <label className="field-label">Remark <span className="required">*</span></label>
          <textarea className="input" rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Why is this being sent back?" autoFocus />
        </div>

        {meta.requirePin && (
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
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={saving || !remark.trim() || (meta.requirePin && pin.length !== 4)} onClick={handleConfirm}>
          Send Back
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
