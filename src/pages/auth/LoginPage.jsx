import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLogin } from "../../hooks/useLogin";
import { MailIcon, LockIcon, ArrowRightIcon, ShowHideButton, BookIcon } from "../../components/icons";
import logo from "../../images/Logo.png";
import "../../styles/Login.css";

// Small line icons for the module chips — kept local since they're only
// used here, matching the stroke weight/size of the shared icon set.
function LeadsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

function EmpanelmentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4" />
      <path d="M12 3c3 0 5 1.5 8 1v9c0 4.5-3.5 6.5-8 8-4.5-1.5-8-3.5-8-8V4c3 0.5 5-1 8-1Z" />
    </svg>
  );
}

function ProposalsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}

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

// Two translucent diagonal bands crossing the hero — purely ornamental,
// echoes the angled crop used across the brand's marketing material. Pure
// CSS (see .login-hero-band), no raster asset — just two skewed rectangles.
function HeroBands() {
  return (
    <div className="login-hero-bands" aria-hidden="true">
      <span className="login-hero-band login-hero-band-1" />
      <span className="login-hero-band login-hero-band-2" />
    </div>
  );
}

// Large thin ring, off-canvas center-right — ambient depth, echoing the
// circular seal in the brand's own logo without reproducing it.
function HeroRing() {
  return <span className="login-hero-ring" aria-hidden="true" />;
}

// "FINANCE / FARMERS / GROWTH" — a vertical label stack, faint against the
// dark hero background.
function HeroSideLabel() {
  return (
    <div className="login-hero-side-label" aria-hidden="true">
      <span>FINANCE</span>
      <span>FARMERS</span>
      <span>GROWTH</span>
    </div>
  );
}

// A single faint upward growth line, tracing behind the hero copy — the
// page's one visual metaphor (rural finance -> growth), kept as a plain
// inline stroke rather than a literal chart so it reads as texture, not UI.
function HeroGrowthLine() {
  return (
    <svg className="login-hero-growth-line" viewBox="0 0 640 360" preserveAspectRatio="none" aria-hidden="true">
      <path d="M-20,320 C120,300 160,220 260,230 C350,238 360,140 460,120 C520,108 560,60 680,20" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="680" cy="20" r="5" fill="currentColor" />
    </svg>
  );
}

// The app's actual modules, not marketing copy — grounds the hero in what
// the staff account genuinely gives access to.
const MODULES = [
  { label: "Leads", icon: LeadsIcon },
  { label: "Empanelment", icon: EmpanelmentIcon },
  { label: "Knowledge Repository", icon: BookIcon },
  { label: "Proposals", icon: ProposalsIcon },
];

function ModuleChips() {
  return (
    <ul className="login-hero-modules">
      {MODULES.map(({ label, icon: Icon }) => (
        <li key={label} className="login-hero-module-chip">
          <Icon />
          <span>{label}</span>
        </li>
      ))}
    </ul>
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
          <HeroRing />
          <HeroBands />
          <HeroGrowthLine />
          <HeroSideLabel />
          <div className="login-hero-content">
            <span className="login-hero-badge">Agricultural Finance Corporation · Since 1968</span>
            <h1 className="login-hero-title">
              Welcome <span className="login-hero-title-accent">back!</span>
            </h1>
            <div className="login-hero-rule" />
            <p className="login-hero-tagline">
              Sign in to access your AFC staff account and continue your work seamlessly.
            </p>
            <ModuleChips />
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

              <div className="login-secure-note">
                <LockIcon />
                <span>Role-based access — every sign-in is scoped to your team and permissions.</span>
              </div>
            </div>

            <p className="login-footer-v2">© {new Date().getFullYear()} AFC India Limited. All rights reserved.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
