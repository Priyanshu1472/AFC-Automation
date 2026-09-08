import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import PinInput from "../../components/ui/PinInput";
import Card from "../../components/ui/Card";
import Alert from "../../components/ui/Alert";
import { LockIcon, ArrowRightIcon, ShowHideButton } from "../../components/icons";

const PIN_PATTERN = /^\d{4}$/;

// A 4-digit action PIN, separate from the login password — gates every
// committee/MD decision in Lead Generation (accept/approve/decline/
// escalate/forward/drop). Mirrors SetPasswordForm's shape: re-verify the
// current password first (supabase.auth.signInWithPassword — the same
// "prove it's really you" gate used everywhere else for a self-service
// change), then call set-own-pin with just the new PIN.
export default function SetPinForm({ hasPin }) {
  const { profile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!currentPassword) return setError("Please enter your current password.");
    if (!PIN_PATTERN.test(pin)) return setError("PIN must be exactly 4 digits.");
    if (pin !== confirmPin) return setError("PINs do not match.");

    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: profile.email, password: currentPassword });
      if (verifyError) {
        setError("Current password is incorrect.");
        return;
      }

      const { error: fnError } = await supabase.functions.invoke("set-own-pin", { body: { new_pin: pin } });
      if (fnError) {
        setError(await extractFunctionErrorMessage(fnError, "Could not update your PIN."));
        return;
      }

      setCurrentPassword("");
      setPin("");
      setConfirmPin("");
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Something went wrong. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="login-card">
      <form onSubmit={submit} noValidate>
        <Card.Body className="login-card-body">
          <div className="login-form-heading">
            <h2>{hasPin ? "Change Action PIN" : "Set Action PIN"}</h2>
            <p>
              A 4-digit PIN used to confirm decisions on leads (accept, approve, decline, escalate, forward, withdraw) —
              separate from your login password, and known only to you.
            </p>
          </div>

          {success && <Alert variant="success">PIN {hasPin ? "updated" : "set"} successfully.</Alert>}
          {error && <Alert variant="danger">{error}</Alert>}

          <div className="login-fields">
            <div style={{ position: "relative" }}>
              <Input
                label="Current password"
                type={show ? "text" : "password"}
                placeholder="Enter your current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                icon={<LockIcon />}
                autoComplete="current-password"
                required
                disabled={loading}
              />
              <div style={{ position: "absolute", right: 10, top: "52%", transform: "translateY(10%)" }}>
                <ShowHideButton show={show} onToggle={() => setShow((p) => !p)} />
              </div>
            </div>
            <PinInput
              label={hasPin ? "New PIN" : "PIN"}
              value={pin}
              onChange={setPin}
              required
              disabled={loading}
            />
            <PinInput
              label="Confirm PIN"
              value={confirmPin}
              onChange={setConfirmPin}
              required
              disabled={loading}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            block
            loading={loading}
            disabled={loading || pin.length !== 4 || confirmPin.length !== 4 || !currentPassword}
            iconRight={!loading && <ArrowRightIcon />}
          >
            {loading ? "Saving…" : hasPin ? "Update PIN" : "Set PIN"}
          </Button>
        </Card.Body>
      </form>
    </Card>
  );
}
