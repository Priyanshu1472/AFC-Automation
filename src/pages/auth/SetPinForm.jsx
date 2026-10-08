import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
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
// current password first (via the verify-own-password edge function, not
// a direct client-side supabase.auth.signInWithPassword call — that's
// captcha-gated through the anon key once Turnstile is enabled; the edge
// function checks server-side with the service role key instead, which is
// exempt), then call set-own-pin with just the new PIN.
// `variant`: "login" (standalone auth-style card) or "section" (a regular
// in-app card, as on My Profile) — same fields and behavior either way.
export default function SetPinForm({ hasPin, variant = "login" }) {
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
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke("verify-own-password", { body: { password: currentPassword } });
      if (verifyError || !verifyData?.success) {
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

  const isSection = variant === "section";
  const heading = hasPin ? "Change Action PIN" : "Set Action PIN";
  const subheading =
    "A 4-digit PIN used to confirm decisions on leads (accept, approve, decline, escalate, forward, withdraw) — separate from your login password, and known only to you.";

  const alerts = (
    <>
      {success && <Alert variant="success">PIN {hasPin ? "updated" : "set"} successfully.</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}
    </>
  );

  const pinInputs = (
    <>
      <PinInput label={hasPin ? "New PIN" : "PIN"} value={pin} onChange={setPin} required disabled={loading} />
      <PinInput label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} required disabled={loading} />
    </>
  );

  const fields = (
    <div className={isSection ? "mp-fields" : "login-fields"}>
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
      {isSection ? <div className="mp-pin-row">{pinInputs}</div> : pinInputs}
    </div>
  );

  const submitButton = (
    <Button
      type="submit"
      variant="primary"
      block={!isSection}
      loading={loading}
      disabled={loading || pin.length !== 4 || confirmPin.length !== 4 || !currentPassword}
      iconRight={!loading && !isSection && <ArrowRightIcon />}
    >
      {loading ? "Saving…" : hasPin ? "Update PIN" : "Set PIN"}
    </Button>
  );

  if (isSection) {
    return (
      <Card className="mp-section-card">
        <form onSubmit={submit} noValidate>
          <Card.Header title={heading} subtitle={subheading} />
          <Card.Body>
            {alerts}
            {fields}
          </Card.Body>
          <Card.Footer className="mp-card-footer">{submitButton}</Card.Footer>
        </form>
      </Card>
    );
  }

  return (
    <Card className="login-card">
      <form onSubmit={submit} noValidate>
        <Card.Body className="login-card-body">
          <div className="login-form-heading">
            <h2>{heading}</h2>
            <p>{subheading}</p>
          </div>
          {alerts}
          {fields}
          {submitButton}
        </Card.Body>
      </form>
    </Card>
  );
}
