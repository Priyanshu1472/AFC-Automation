// src/components/ui/Collapsible.jsx
// A foldable section — meant to sit directly inside a <Card> in place of
// Card.Header/Card.Body (shares their padding, see .collapsible-* in
// App.css). Built on native <details>/<summary> so open/close is entirely
// browser-managed — no React state to fall out of sync when the parent
// page re-renders (this page re-fetches on every realtime change).
export default function Collapsible({ title, subtitle, defaultOpen = true, children, className = "" }) {
  return (
    <details className={`collapsible ${className}`.trim()} open={defaultOpen}>
      <summary className="collapsible-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="collapsible-subtitle">{subtitle}</p>}
        </div>
        <svg className="collapsible-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="collapsible-body-inner">{children}</div>
    </details>
  );
}
