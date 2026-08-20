import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLogin } from "../../hooks/useLogin";
import { MailIcon, LockIcon, ArrowRightIcon, ShowHideButton } from "../../components/icons";
import logo from "../../images/Logo.png";
import "../../styles/Login.css";

function ChevronDownIcon({ open }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function UserCircleIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.5 3.5-6 8-6s8 2.5 8 6" />
    </svg>
  );
}

// A slim decorative flow of curved lines behind the hero copy — purely
// ornamental, so it's inline SVG rather than a raster asset.
function HeroWaves() {
  return (
    <svg className="login-hero-waves" viewBox="0 0 800 900" preserveAspectRatio="none" aria-hidden="true">
      <path d="M-50,200 C150,120 300,280 500,180 S780,60 900,160" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.28" />
      <path d="M-50,420 C180,340 340,520 560,420 S820,300 900,400" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.18" />
      <path d="M-50,650 C160,580 360,760 540,650 S800,540 900,630" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.14" />
    </svg>
  );
}

function BusinessAssociateMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="login-ba-menu" ref={ref}>
      <button type="button" className="login-ba-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        Business Associate <ChevronDownIcon open={open} />
      </button>
      {open && (
        <div className="login-ba-dropdown" role="menu">
          <Link to="/ba-form" className="login-ba-item" role="menuitem" onClick={() => setOpen(false)}>
            Fill Empanelment Form
          </Link>
          <Link to="/empanelment/correction" className="login-ba-item" role="menuitem" onClick={() => setOpen(false)}>
            Submit a Correction
          </Link>
          <Link to="/empanelment/status" className="login-ba-item" role="menuitem" onClick={() => setOpen(false)}>
            Check Application Status
          </Link>
        </div>
      )}
    </div>
  );
}

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
    <div className="login-page-v2">
      <header className="login-topbar">
        <div className="login-topbar-brand">
          <img src={logo} alt="AFC India Limited" className="login-topbar-logo" />
          <span className="login-topbar-name">AFC India Limited</span>
        </div>
        <BusinessAssociateMenu />
      </header>

      <div className="login-main">
        <section className="login-hero">
          <img src={logo} alt="" aria-hidden="true" className="login-hero-watermark" />
          <HeroWaves />
          <div className="login-hero-content">
            <h1 className="login-hero-title">
              Welcome <span className="login-hero-title-accent">back!</span>
            </h1>
            <div className="login-hero-rule" />
            <p className="login-hero-tagline">
              Sign in to access your AFC staff account and continue your work seamlessly.
            </p>
          </div>
        </section>

        <section className="login-panel">
          <div className="login-panel-inner">
            <div className="login-card-v2">
              <div className="login-card-icon"><UserCircleIcon /></div>
              <h2 className="login-card-title">Welcome back</h2>
              <p className="login-card-sub">Sign in to your AFC staff account</p>

              {error && <div className="login-error-v2" role="alert">{error}</div>}

              <form onSubmit={handleLogin} noValidate autoComplete="on" className="login-form-v2">
                <div className="login-field-v2">
                  <label htmlFor="email" className="login-label-v2">
                    Email Address <span className="login-required-v2">*</span>
                  </label>
                  <div className="login-input-v2">
                    <span className="login-input-icon"><MailIcon /></span>
                    <input
                      id="email"
                      type="email"
                      placeholder="you@afcindia.org.in"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      autoFocus
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="login-field-v2">
                  <label htmlFor="password" className="login-label-v2">
                    Password <span className="login-required-v2">*</span>
                  </label>
                  <div className="login-input-v2">
                    <span className="login-input-icon"><LockIcon /></span>
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      disabled={loading}
                    />
                    <ShowHideButton show={showPassword} onToggle={() => setShowPassword((p) => !p)} />
                  </div>
                  <div className="login-forgot-row">
                    <Link to="/forgot-password">Forgot password?</Link>
                  </div>
                </div>

                <AttemptsBar used={attempts} />

                <button type="submit" className="login-submit-btn" disabled={loading || !email || !password}>
                  {loading ? (
                    <span className="spinner spinner-sm" aria-hidden="true" />
                  ) : (
                    <>
                      <span>Sign in</span>
                      <ArrowRightIcon />
                    </>
                  )}
                </button>
              </form>
            </div>

            <p className="login-footer-v2">© {new Date().getFullYear()} AFC India Limited. All rights reserved.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
