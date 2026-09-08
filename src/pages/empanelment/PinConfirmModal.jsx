import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PinInput from "../../components/ui/PinInput";

const ACTION_META = {
  md_accept: { fnName: "advance-empanelment-stage", label: "accept this application" },
  md_reject: { fnName: "advance-empanelment-stage", label: "reject this application" },
  provisional_letter: { fnName: "send-provisional-letter", label: "send the provisional letter" },
};

// Gates MD accept/reject and the DGM's provisional-letter send behind the
// actor's own 4-digit action PIN (same PIN used across Leads) — replaces
// the previous email-OTP round trip. The real action only fires inside
// handleConfirm's call to the actual endpoint (advance-empanelment-stage /
// send-provisional-letter) — that endpoint's own server-side PIN check is
// the real gate, so nothing mutates or emails out until it succeeds.
export default function PinConfirmModal({ applicationId, action, comment, onClose, onSuccess }) {
  const meta = ACTION_META[action];
  const [pin, setPin] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter your 4-digit PIN.");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const body =
        action === "provisional_letter"
          ? { application_id: applicationId, pin }
          : { application_id: applicationId, action, comment, pin };
      const { data, error: err } = await supabase.functions.invoke(meta.fnName, { body });
      if (err) {
        setError(await extractFunctionErrorMessage(err, "Verification failed."));
        return;
      }
      if (!data?.success) {
        setError(data?.error || "Verification failed.");
        return;
      }
      onSuccess(data);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="ar-modal-backdrop" onClick={() => !verifying && onClose()}>
      <div className="ar-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ar-modal-header">
          <h3 className="ar-modal-title">Confirm to {meta.label}</h3>
          <p className="ar-modal-desc">Enter your 4-digit action PIN to confirm — nothing happens until it&apos;s verified.</p>
        </div>

        {error && (
          <Alert variant="danger" onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        <div className="ar-field">
          <PinInput
            label="Your Action PIN"
            required
            value={pin}
            onChange={setPin}
            disabled={verifying}
            autoFocus
            hint="Confirms it's really you — set or change this from My Profile."
          />
        </div>

        <div className="ar-modal-actions">
          <Button variant="primary" block loading={verifying} disabled={verifying || pin.length !== 4} onClick={handleConfirm}>
            {verifying ? "Verifying…" : "Confirm"}
          </Button>
          <Button variant="ghost" block disabled={verifying} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
