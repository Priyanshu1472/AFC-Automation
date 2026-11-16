// One small confirm modal for the Accounts / EMD steps on a proposal —
// "Mark Payment Done", "Verify EMD Refund", "Confirm PBG Processed",
// "Send Back", "Forward to Accounts". Each caller says which fields it needs
// (payment reference, remark — optional or required — and the action PIN)
// and what to run; the edge function behind `run` is the real gate.
import { useState } from "react";
import { extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import PinInput from "../ui/PinInput";

export default function FinanceActionModal({
  title,
  intro,
  confirmLabel,
  confirmVariant = "primary",
  withReference = false,
  remarkLabel = "Remarks",
  remarkRequired = false,
  withPin = false,
  run, // async ({ remark, reference, pin }) => supabase.functions.invoke(...) result
  onClose,
  onSuccess,
}) {
  const [remark, setRemark] = useState("");
  const [reference, setReference] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = (!remarkRequired || remark.trim()) && (!withPin || pin.length === 4);

  async function confirm() {
    if (remarkRequired && !remark.trim()) { setError(`${remarkLabel} is required.`); return; }
    if (withPin && !/^\d{4}$/.test(pin)) { setError("Enter your 4-digit PIN."); return; }
    setBusy(true);
    setError("");
    try {
      const { data, error: fnErr } = await run({ remark: remark.trim(), reference: reference.trim(), pin });
      if (fnErr) { setError(await extractFunctionErrorMessage(fnErr, "Something went wrong.")); return; }
      if (!data?.success) { setError(data?.error || "Something went wrong."); return; }
      onSuccess();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal size="md" onClose={() => !busy && onClose()} closeOnBackdrop={!busy}>
      <Modal.Header title={title} onClose={!busy ? onClose : undefined} />
      <Modal.Body>
        <div className="pp-fin-modal">
          {intro && <p className="pp-fin-modal-intro">{intro}</p>}
          {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
          {withReference && (
            <div className="field">
              <label className="field-label" htmlFor="fin-ref">Payment reference / UTR (optional)</label>
              <input id="fin-ref" className="input" value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} disabled={busy} placeholder="e.g. UTR / DD / BG number" />
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="fin-remark">
              {remarkLabel}{remarkRequired ? <span className="field-required"> *</span> : " (optional)"}
            </label>
            <textarea id="fin-remark" className="input" rows={3} value={remark} maxLength={2000} onChange={(e) => setRemark(e.target.value)} disabled={busy} />
          </div>
          {withPin && (
            <PinInput label="Your Action PIN" required value={pin} onChange={setPin} disabled={busy} hint="Confirms it's really you" />
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant={confirmVariant} loading={busy} disabled={busy || !ready} onClick={confirm}>{confirmLabel}</Button>
      </Modal.Footer>
    </Modal>
  );
}
