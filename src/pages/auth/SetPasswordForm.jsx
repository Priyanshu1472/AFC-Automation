import { useSetNewPassword } from "../../hooks/useSetNewPassword";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Alert from "../../components/ui/Alert";
import Card from "../../components/ui/Card";
import { LockIcon, ArrowRightIcon, ShowHideButton } from "../../components/icons";
import { useState } from "react";

// Shared by ResetPasswordPage (via emailed magic link), ChangePasswordPage
// (forced on first login), and MyProfilePage (voluntary change) — same
// rules, same hook. Pass hookOptions to change the post-submit behavior
// (see useSetNewPassword) and successMessage to show an inline confirmation
// instead of redirecting away. `variant`: "login" (the standalone auth-page
// card) or "section" (a regular in-app card, as on My Profile).
export default function SetPasswordForm({ heading, subheading, submitLabel = "Set password", hookOptions, successMessage, variant = "login" }) {
  const {
    currentPassword,
    setCurrentPassword,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    loading,
    success,
    submit,
  } = useSetNewPassword(hookOptions);
  const [show, setShow] = useState(false);
  const requireCurrentPassword = !!hookOptions?.requireCurrentPassword;
  const isSection = variant === "section";

  const alerts = (
    <>
      {success && successMessage && <Alert variant="success">{successMessage}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}
    </>
  );

  const fields = (
    <div className={isSection ? "mp-fields" : "login-fields"}>
      {requireCurrentPassword && (
        <Input
          label="Current password"
          id="current-password"
          type={show ? "text" : "password"}
          placeholder="Enter your current password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          icon={<LockIcon />}
          autoComplete="current-password"
          required
          disabled={loading}
        />
      )}
      <div style={{ position: "relative" }}>
        <Input
          label="New password"
          id="new-password"
          type={show ? "text" : "password"}
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          icon={<LockIcon />}
          autoComplete="new-password"
          required
          disabled={loading}
        />
        <div style={{ position: "absolute", right: 10, top: "52%", transform: "translateY(10%)" }}>
          <ShowHideButton show={show} onToggle={() => setShow((p) => !p)} />
        </div>
      </div>
      <Input
        label="Confirm new password"
        id="confirm-password"
        type={show ? "text" : "password"}
        placeholder="Re-enter password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        icon={<LockIcon />}
        autoComplete="new-password"
        required
        disabled={loading}
        hint="Must include an uppercase letter, lowercase letter, digit, and symbol."
      />
    </div>
  );

  const submitButton = (
    <Button
      type="submit"
      variant="primary"
      block={!isSection}
      loading={loading}
      disabled={loading || !password || !confirmPassword || (requireCurrentPassword && !currentPassword)}
      iconRight={!loading && !isSection && <ArrowRightIcon />}
    >
      {loading ? "Saving…" : submitLabel}
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
