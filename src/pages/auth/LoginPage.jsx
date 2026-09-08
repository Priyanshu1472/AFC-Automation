import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLogin } from "../../hooks/useLogin";
import ThemeToggle from "../../components/shared/ThemeToggle";
import { MailIcon, LockIcon, ArrowRightIcon, ShowHideButton } from "../../components/icons";
import logo from "../../images/Logo.png";
import "../../styles/LoginGlass.css";

// Small line icons for the Business Partner routes — local since they're
// only used on this screen.
function FormIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}
function CorrectionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function StatusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function ChevronDownIcon({ open }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function AlertTriangleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  );
}

// The applicant-facing empanelment pages need no staff login.
const BP_ROUTES = [
  { to: "/ba-form", label: "Fill Empanelment Form", Icon: FormIcon },
  { to: "/empanelment/correction", label: "Submit a Correction", Icon: CorrectionIcon },
  { to: "/empanelment/status", label: "Check Application Status", Icon: StatusIcon },
];

function BusinessPartnerMenu() {
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
    <div className="afc-bp-menu" ref={ref}>
      <button
        type="button"
        className="afc-bp-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Business Partner
        <ChevronDownIcon open={open} />
      </button>
      {open && (
        <div className="afc-bp-dropdown" role="menu">
          {BP_ROUTES.map(({ to, label, Icon }) => (
            <Link
              key={to}
              to={to}
              className="afc-bp-item"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <Icon />
              {label}
            </Link>
          ))}
        </div>
      )}
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
    handleLogin,
  } = useLogin();

  // Play the "Welcome back." reveal once the page is actually visible:
  // straight away when arriving via in-app navigation (no boot splash),
  // and as the boot splash fades on a cold load.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const splash = document.getElementById("app-splash");
    if (!splash) {
      const t = setTimeout(() => setRevealed(true), 60);
      return () => clearTimeout(t);
    }
    let fired = false;
    const reveal = () => {
      if (fired) return;
      fired = true;
      setRevealed(true);
    };
    const onSplash = new MutationObserver(() => {
      if (splash.classList.contains("is-hidden") || !document.getElementById("app-splash")) {
        setTimeout(reveal, 220);
        onSplash.disconnect();
      }
    });
    onSplash.observe(splash, { attributes: true, attributeFilter: ["class"] });
    const fallback = setTimeout(reveal, 3200);
    return () => {
      onSplash.disconnect();
      clearTimeout(fallback);
    };
  }, []);

  return (
    <div className="afc-login">
      <header className="afc-login-header">
        <div className="afc-login-lockup">
          <img src={logo} alt="" />
          <span>AFC India Limited</span>
        </div>
        <div className="afc-login-actions">
          <BusinessPartnerMenu />
          <ThemeToggle />
        </div>
      </header>

      <div className="afc-login-inner">
        {/* ── Brand side ─────────────────────────────── */}
        <div className={`afc-login-brand${revealed ? " is-revealed" : ""}`}>
          <h1 className="afc-login-title">
            <span className="afc-login-title-w"><span>Welcome</span></span>{" "}
            <span className="afc-login-title-w"><span>back.</span></span>
          </h1>
          <p className="afc-login-tagline">Project Management Information System</p>
        </div>

        {/* ── Card side ──────────────────────────────── */}
        <div className="afc-login-card">
          <h2 className="afc-login-card-title">Sign in</h2>

          {error && (
            <div className="afc-login-error" role="alert">
              <AlertTriangleIcon />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} noValidate autoComplete="on" className="afc-login-form">
            <div className="afc-field">
              <label htmlFor="email">Email address</label>
              <div className="afc-control">
                <MailIcon />
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

            <div className="afc-field">
              <label htmlFor="password">Password</label>
              <div className="afc-control">
                <LockIcon />
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
            </div>

            <div className="afc-login-forgot">
              <Link to="/forgot-password">Forgot password?</Link>
            </div>

            <button
              type="submit"
              className="afc-btn-primary"
              disabled={loading || !email || !password}
            >
              {loading ? "Signing in…" : "Sign in"}
              {!loading && <ArrowRightIcon />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
