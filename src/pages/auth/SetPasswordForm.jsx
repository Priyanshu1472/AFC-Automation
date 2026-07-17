import { useSetNewPassword } from "../../hooks/useSetNewPassword";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Alert from "../../components/ui/Alert";
import Card from "../../components/ui/Card";
import { LockIcon, ArrowRightIcon, ShowHideButton } from "../../components/icons";
import { useState } from "react";

// Shared by ResetPasswordPage (via emailed magic link) and
// ChangePasswordPage (forced on first login) — same rules, same hook.
export default function SetPasswordForm({ heading, subheading, submitLabel = "Set password" }) {
  const { password, setPassword, confirmPassword, setConfirmPassword, error, loading, submit } =
    useSetNewPassword();
  const [show, setShow] = useState(false);

  return (
    <Card className="login-card">
      <form onSubmit={submit} noValidate>
        <Card.Body className="login-card-body">
          <div className="login-form-heading">
            <h2>{heading}</h2>
            <p>{subheading}</p>
          </div>

          {error && <Alert variant="danger">{error}</Alert>}

          <div className="login-fields">
            <div style={{ position: "relative" }}>
              <Input
                label="New password"
                id="new-password"
                type={show ? "text" : "password"}
                placeholder="At least 12 characters"
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

          <Button
            type="submit"
            variant="primary"
            block
            loading={loading}
            disabled={loading || !password || !confirmPassword}
            iconRight={!loading && <ArrowRightIcon />}
          >
            {loading ? "Saving…" : submitLabel}
          </Button>
        </Card.Body>
      </form>
    </Card>
  );
}
