// Mirrors LeadConversionOtpModal.jsx's exact flow (request code on mount,
// verify inside the same call that performs the action) against the
// parallel fee-note OTP endpoints. decision is 'approved' | 'rejected'.
import { useEffect, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";

const RESEND_COOLDOWN_SECONDS = 60;

export default function FeeNoteOtpModal({ feeNoteId, decision, remark, onClose, onSuccess }) {
  const otpAction = decision === "approved" ? "md_approve" : "md_reject";
  const label = decision === "approved" ? "approve this fee note" : "reject this fee note";

  const [requesting, setRequesting] = useState(true);
  const [sentTo, setSentTo] = useState(null);
  const [otp, setOtp] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  async function requestCode() {
    setRequesting(true);
    setError("");
    try {
      const { data, error: err } = await supabase.functions.invoke("request-fee-note-otp", {
        body: { fee_note_id: feeNoteId, action: otpAction },
      });
      if (err) { setError(await extractFunctionErrorMessage(err, "Failed to send verification code.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to send verification code."); return; }
      setSentTo(data.sent_to);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setRequesting(false);
    }
  }

  useEffect(() => {
    requestCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleVerify() {
    if (!/^\d{6}$/.test(otp)) { setError("Enter the 6-digit code."); return; }
    setVerifying(true);
    setError("");
    try {
      const { data, error: err } = await supabase.functions.invoke("decide-fee-note-md", {
        body: { fee_note_id: feeNoteId, decision, remark: remark || null, otp },
      });
      if (err) { setError(await extractFunctionErrorMessage(err, "Verification failed.")); return; }
      if (!data?.success) { setError(data?.error || "Verification failed."); return; }
      onSuccess();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Modal onClose={!verifying ? onClose : undefined} closeOnBackdrop={!verifying}>
      <Modal.Header
        title={`Verify to ${label}`}
        subtitle={requesting ? "Sending a verification code…" : sentTo ? `A 6-digit code was emailed to ${sentTo}. Enter it below to confirm — nothing will be finalized until it's verified.` : "Could not send the code."}
        onClose={!verifying ? onClose : undefined}
      />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <div className="field">
          <label className="field-label">Verification Code</label>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit code"
            disabled={verifying || requesting}
            autoFocus
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={verifying || requesting || cooldown > 0} onClick={requestCode}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </Button>
        <Button variant="ghost" disabled={verifying} onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={verifying} disabled={verifying || requesting || otp.length !== 6} onClick={handleVerify}>
          Verify &amp; Confirm
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
