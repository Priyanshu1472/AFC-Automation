import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Alert from "../../components/ui/Alert";
import Card from "../../components/ui/Card";
import Turnstile from "../../components/shared/Turnstile";
import { MailIcon, ArrowRightIcon } from "../../components/icons";
import logo from "../../images/Logo.png";
import "../../styles/Login.css";

function isValidEmail(val) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  // Captcha protection on the Supabase project gates password recovery too,
  // not just sign-in — without a token /auth/v1/recover is rejected with
  // captcha_failed. A token is single-use, so bump the key to remount the
  // widget for a fresh challenge after every attempt.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");

      const trimmed = email.trim().toLowerCase();
      if (!isValidEmail(trimmed)) return setError("Please enter a valid email address.");
      if (!captchaToken) return setError("Please complete the verification challenge.");

      setLoading(true);
      try {
        // Supabase's /recover answers "sent" even for unregistered addresses,
        // so check first — an unknown or deactivated email gets a clear
        // error instead of a reset link that will never arrive.
        const { error: checkError } = await supabase.functions.invoke("check-reset-email", {
          body: { email: trimmed },
        });
        if (checkError) {
          setError(await extractFunctionErrorMessage(checkError, "Could not verify this email. Please try again."));
          return;
        }

        const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
          redirectTo: `${window.location.origin}/reset-password`,
          captchaToken,
        });
        if (resetError) {
          setError(resetError.message || "Could not send the reset link. Please try again.");
          return;
        }
        setSent(true);
      } catch {
        setError("Something went wrong. Please check your connection and try again.");
      } finally {
        setLoading(false);
        setCaptchaToken("");
        setCaptchaResetKey((k) => k + 1);
      }
    },
    [email, captchaToken]
  );

  return (
    <div className="login-page">
      <div className="login-brand" aria-hidden="true">
        <div className="login-brand-inner">
          <h1 className="login-brand-title">
            AFC India
            <br />
            Limited
          </h1>
          <p className="login-brand-sub">
            Project Management Information System
          </p>
          <div className="login-brand-rule" />
        </div>
      </div>

      <div className="login-form-panel">
        <div className="login-form-inner">
          <div className="login-logo-row">
            <img src={logo} height={52} alt="AFC India Limited logo" className="login-logo-img" />
            <div className="login-org-info">
              <div className="login-org-name">AFC India Limited</div>
            </div>
          </div>

          <Card className="login-card">
            {sent ? (
              <Card.Body className="login-card-body">
                <div className="login-form-heading">
                  <h2>Check your email</h2>
                  <p>A password reset link has been sent to your email address.</p>
                </div>
                <Link to="/login">
                  <Button variant="secondary" block>
                    Back to sign in
                  </Button>
                </Link>
              </Card.Body>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <Card.Body className="login-card-body">
                  <div className="login-form-heading">
                    <h2>Reset your password</h2>
                    <p>Enter your account email and we'll send you a reset link.</p>
                  </div>

                  {error && <Alert variant="danger">{error}</Alert>}

                  <div className="login-fields">
                    <Input
                      label="Email Address"
                      id="email"
                      type="email"
                      placeholder="you@afcindia.org.in"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      icon={<MailIcon />}
                      autoComplete="email"
                      autoFocus
                      required
                      disabled={loading}
                    />
                  </div>

                  <Turnstile
                    key={captchaResetKey}
                    onVerify={setCaptchaToken}
                    onExpire={() => setCaptchaToken("")}
                  />

                  <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={loading}
                    disabled={loading || !email || !captchaToken}
                    iconRight={!loading && <ArrowRightIcon />}
                  >
                    {loading ? "Sending…" : "Send reset link"}
                  </Button>

                  <div style={{ textAlign: "center" }}>
                    <Link to="/login" className="text-sm">
                      Back to sign in
                    </Link>
                  </div>
                </Card.Body>
              </form>
            )}
          </Card>

          <p className="login-footer-note">© {new Date().getFullYear()} AFC India Limited. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
