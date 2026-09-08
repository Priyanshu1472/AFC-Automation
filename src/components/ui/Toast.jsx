// src/components/ui/Toast.jsx
// Visually reuses the .alert / alert-{variant} classes from App.css so
// toasts and inline alerts look like the same design language.

const ICONS = {
  success: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  warning: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  ),
  danger: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="8" /><line x1="12" x2="12" y1="12" y2="16" />
    </svg>
  ),
};

export default function Toast({ variant = "info", duration = 5000, onClose, children }) {
  return (
    <div className={`alert alert-${variant} toast`} role="status">
      <span className="alert-icon">{ICONS[variant] || ICONS.info}</span>
      <div className="alert-content" style={{ flex: 1 }}>{children}</div>
      {onClose && (
        <button
          className="alert-close"
          onClick={onClose}
          aria-label="Dismiss"
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, padding: "0 0 0 8px", display: "flex", alignItems: "center" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
      {/* Visual countdown to auto-dismiss — omitted for sticky (duration:0) toasts. */}
      {duration > 0 && <div className="toast-countdown" style={{ "--toast-duration": `${duration}ms` }} aria-hidden="true" />}
    </div>
  );
}
