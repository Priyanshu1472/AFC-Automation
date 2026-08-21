// Admin-only: sets a new 4-digit action PIN for another user. The PIN is
// one-way hashed server-side — nobody, including Admin, can ever view the
// current value, only reset it to a new one. Gated by the ADMIN'S OWN
// password (re-verified via supabase.auth.signInWithPassword, same pattern
// as every other self-service sensitive action in this app), not the
// target user's — Admin doesn't and shouldn't know that.
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import Modal from "../../components/ui/Modal";
import Input from "../../components/ui/Input";
import PinInput from "../../components/ui/PinInput";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import { LockIcon } from "../../components/icons";

const PIN_PATTERN = /^\d{4}$/;

export default function ResetPinModal({ targetUserId, targetName, onClose, onSuccess }) {
  const { profile } = useAuth();
  const [adminPassword, setAdminPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    if (!adminPassword) return setError("Enter your own password to confirm.");
    if (!PIN_PATTERN.test(pin)) return setError("PIN must be exactly 4 digits.");
    if (pin !== confirmPin) return setError("PINs do not match.");

    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: profile.email, password: adminPassword });
      if (verifyError) {
        setError("Your password is incorrect.");
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke("admin-reset-pin", { body: { user_id: targetUserId, new_pin: pin } });
      if (fnError) {
        setError(await extractFunctionErrorMessage(fnError, "Could not reset the PIN."));
        return;
      }
      if (!data?.success) {
        setError(data?.error || "Could not reset the PIN.");
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onClose={!loading ? onClose : undefined} closeOnBackdrop={!loading}>
      <Modal.Header title="Reset Action PIN" subtitle={`Set a new PIN for ${targetName}. They'll use this new PIN going forward.`} onClose={!loading ? onClose : undefined} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <div className="login-fields">
          <Input
            label="Your password"
            type="password"
            placeholder="Confirm it's you"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            icon={<LockIcon />}
            autoComplete="current-password"
            required
            disabled={loading}
          />
          <PinInput label="New PIN" value={pin} onChange={setPin} required disabled={loading} />
          <PinInput label="Confirm new PIN" value={confirmPin} onChange={setConfirmPin} required disabled={loading} />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={loading} onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={loading} disabled={loading || pin.length !== 4 || confirmPin.length !== 4 || !adminPassword} onClick={handleSubmit}>
          Reset PIN
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
