import { Link } from "react-router-dom";
import { useLogin } from "../../hooks/useLogin";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Alert from "../../components/ui/Alert";
import Card from "../../components/ui/Card";
import { MailIcon, LockIcon, ArrowRightIcon, ShowHideButton } from "../../components/icons";
import logo from "../../images/Logo.png";
import "../../styles/Login.css";

function AttemptsBar({ used, max = 5 }) {
  if (used === 0) return null;
  const remaining = max - used;
  return (
    <div className="login-attempts-bar" aria-label={`${remaining} attempts remaining`}>
      {Array.from({ length: max }, (_, i) => (
        <div key={i} className={`login-attempts-pip${i < remaining ? " login-attempts-pip-ok" : " login-attempts-pip-used"}`} />
      ))}
      <span className="login-attempts-label">
        {remaining} attempt{remaining !== 1 ? "s" : ""} left
      </span>
    </div>
  );
}

export default function LoginPage() {
  const {
    email,
    setEmail,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    error,
    loading,
    attempts,
    handleLogin,
  } = useLogin();

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
            <form onSubmit={handleLogin} noValidate autoComplete="on">
              <Card.Body className="login-card-body">
                <div className="login-form-heading">
                  <h2>Welcome back</h2>
                  <p>Sign in to your AFC staff account</p>
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
                  <div>
                    <div style={{ position: "relative" }}>
                      <Input
                        label="Password"
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        icon={<LockIcon />}
                        autoComplete="current-password"
                        required
                        disabled={loading}
                      />
                      <div style={{ position: "absolute", right: 10, top: "52%", transform: "translateY(10%)" }}>
                        <ShowHideButton show={showPassword} onToggle={() => setShowPassword((p) => !p)} />
                      </div>
                    </div>
                    <div className="login-forgot-link">
                      <Link to="/forgot-password">Forgot password?</Link>
                    </div>
                  </div>
                </div>

                <AttemptsBar used={attempts} />

                <Button
                  type="submit"
                  variant="primary"
                  block
                  loading={loading}
                  disabled={loading || !email || !password}
                  iconRight={!loading && <ArrowRightIcon />}
                >
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
              </Card.Body>
            </form>
          </Card>

          <div className="login-ba-panel">
            <p className="login-ba-heading">Business Associate?</p>
            <div className="login-ba-links">
              <Link to="/ba-form" className="login-ba-link">Fill Empanelment Form</Link>
              <span className="login-ba-sep" aria-hidden="true">·</span>
              <Link to="/empanelment/correction" className="login-ba-link">Submit a Correction</Link>
            </div>
          </div>

          <p className="login-footer-note">© {new Date().getFullYear()} AFC India Limited. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
