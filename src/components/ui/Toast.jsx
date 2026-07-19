// src/components/ui/Toast.jsx
// Visually reuses the .alert / alert-{variant} classes from App.css so
// toasts and inline alerts look like the same design language.

export default function Toast({ variant = "info", onClose, children }) {
  return (
    <div className={`alert alert-${variant} toast`} role="status">
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
    </div>
  );
}
