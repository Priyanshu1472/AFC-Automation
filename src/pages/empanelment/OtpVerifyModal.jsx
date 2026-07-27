import { useEffect, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";

const ACTION_META = {
  md_accept: { fnName: "advance-empanelment-stage", label: "accept this application" },
  md_reject: { fnName: "advance-empanelment-stage", label: "reject this application" },
  provisional_letter: { fnName: "send-provisional-letter", label: "send the provisional letter" },
};

const RESEND_COOLDOWN_SECONDS = 60;

// Gates MD accept/reject and the DGM's provisional-letter send behind a
// code emailed to the actor's own address. The real action only fires
// inside handleVerify's call to the actual endpoint (advance-empanelment-
// stage / send-provisional-letter) — that endpoint's own server-side check
// is the real gate, so nothing mutates or emails out until it succeeds.
export default function OtpVerifyModal({ applicationId, action, comment, onClose, onSuccess }) {
  const meta = ACTION_META[action];
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
      const { data, error: err } = await supabase.functions.invoke("request-empanelment-otp", {
        body: { application_id: applicationId, action },
      });
      if (err) {
        setError(await extractFunctionErrorMessage(err, "Failed to send verification code."));
        return;
      }
      if (!data?.success) {
        setError(data?.error || "Failed to send verification code.");
        return;
      }
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
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const body =
        action === "provisional_letter"
          ? { application_id: applicationId, otp }
          : { application_id: applicationId, action, comment, otp };
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
          <h3 className="ar-modal-title">Verify to {meta.label}</h3>
          <p className="ar-modal-desc">
            {requesting
              ? "Sending a verification code…"
              : sentTo
                ? <>A 6-digit code was emailed to <strong>{sentTo}</strong>. Enter it below to confirm — nothing will be sent until it's verified.</>
                : "Could not send the code."}
          </p>
        </div>

        {error && (
          <Alert variant="danger" onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        <div className="ar-field">
          <label className="ar-label">Verification Code</label>
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

        <div className="ar-modal-actions">
          <Button variant="primary" block loading={verifying} disabled={verifying || requesting || otp.length !== 6} onClick={handleVerify}>
            {verifying ? "Verifying…" : "Verify & Confirm"}
          </Button>
          <Button variant="secondary" block disabled={verifying || requesting || cooldown > 0} onClick={requestCode}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </Button>
          <Button variant="ghost" block disabled={verifying} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
