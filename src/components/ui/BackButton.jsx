import { useNavigate } from "react-router-dom";

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

/**
 * The one "back" control used at the top-left of every page, directly above
 * the page title — same look and position everywhere.
 *
 *  <BackButton to="/leads" label="Back to Leads" />
 *  <BackButton label="Back" fallback="/knowledge" />   // browser-back
 *
 * Without `to` it goes one step back in history, falling back to `fallback`
 * when the page was opened directly (no in-app history to go back to).
 */
export default function BackButton({ to, label = "Back", fallback = "/home", disabled = false, className = "" }) {
  const navigate = useNavigate();

  function handleClick() {
    if (to) navigate(to);
    else if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(fallback);
  }

  return (
    <button type="button" className={`back-link ${className}`.trim()} onClick={handleClick} disabled={disabled}>
      <ArrowLeftIcon />
      <span>{label}</span>
    </button>
  );
}
