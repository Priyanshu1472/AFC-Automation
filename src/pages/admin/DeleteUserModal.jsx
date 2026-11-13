// Admin-only: permanently deletes a user account (auth + afc_users profile
// — see delete-staff-user for exactly what that touches and why it fails
// cleanly for any account with real history instead of cascading into
// leads/proposals). Two safety gates before the irreversible call:
// re-verifying the Admin's own password (via the verify-own-password edge
// function, same pattern as ResetPinModal — not a direct client-side
// supabase.auth.signInWithPassword call, which is captcha-gated through
// the anon key once Turnstile is enabled), and typing the target's exact
// email to confirm — a plain "Are you sure" button is too easy to click by
// accident for something this permanent.
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../../components/ui/Modal";
import Input from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import { LockIcon } from "../../components/icons";

export default function DeleteUserModal({ targetUserId, targetName, targetEmail, onClose, onSuccess }) {
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const emailMatches = confirmEmail.trim().toLowerCase() === targetEmail.trim().toLowerCase();

  async function handleSubmit() {
    setError("");
    if (!adminPassword) return setError("Enter your own password to confirm.");
    if (!emailMatches) return setError("Typed email doesn't match — type it exactly to confirm.");

    setLoading(true);
    try {
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke("verify-own-password", { body: { password: adminPassword } });
      if (verifyError || !verifyData?.success) {
        setError("Your password is incorrect.");
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke("delete-staff-user", { body: { user_id: targetUserId } });
      if (fnError) {
        setError(await extractFunctionErrorMessage(fnError, "Could not delete this user."));
        return;
      }
      if (!data?.success) {
        setError(data?.error || "Could not delete this user.");
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
      <Modal.Header title="Delete User" subtitle={`Permanently delete ${targetName}. This cannot be undone.`} onClose={!loading ? onClose : undefined} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <Alert variant="warning">
          This removes their login and profile entirely — it only succeeds if they have no leads, proposals, or other
          activity on record. If they do, deactivate the account instead (Users list → Deactivate); that keeps their
          history intact and can be reversed.
        </Alert>
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
          <Input
            label={`Type "${targetEmail}" to confirm`}
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={targetEmail}
            required
            disabled={loading}
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={loading} onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={loading} disabled={loading || !adminPassword || !emailMatches} onClick={handleSubmit}>
          Delete Permanently
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
