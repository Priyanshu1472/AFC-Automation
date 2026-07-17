import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Alert from "../../components/ui/Alert";
import Card from "../../components/ui/Card";
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

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");

      const trimmed = email.trim().toLowerCase();
      if (!isValidEmail(trimmed)) return setError("Please enter a valid email address.");

      setLoading(true);
      try {
        await supabase.auth.resetPasswordForEmail(trimmed, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
      } finally {
        // Always show the same generic outcome, whether or not the
        // account exists — avoids leaking which emails are registered.
        setLoading(false);
        setSent(true);
      }
    },
    [email]
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
            Agricultural Finance Corporation.
            <br />
            Serving India since 1968.
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
                  <p>If an account exists for that address, a password reset link has been sent.</p>
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

                  <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={loading}
                    disabled={loading || !email}
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
