// src/components/ui/Collapsible.jsx
// A foldable section — meant to sit directly inside a <Card> in place of
// Card.Header/Card.Body (shares their padding, see .collapsible-* in
// App.css). Built on native <details>/<summary> so open/close is entirely
// browser-managed — no React state to fall out of sync when the parent
// page re-renders (this page re-fetches on every realtime change).
//
// Pass expandable={false} for a section that should always stay fully
// visible (no chevron, no click-to-collapse) while still sharing the same
// icon/title/subtitle/action header look as every other card on the page.
export default function Collapsible({ title, subtitle, icon, action, defaultOpen = true, expandable = true, children, className = "" }) {
  const header = (
    <>
      <div className="collapsible-header-main">
        {icon && <span className="collapsible-icon" aria-hidden="true">{icon}</span>}
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="collapsible-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="collapsible-header-end">
        {/* Stop a click on the action from also toggling the details
            element open/closed. */}
        {action && <span className="collapsible-action" onClick={(e) => e.stopPropagation()}>{action}</span>}
        {expandable && (
          <svg className="collapsible-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </div>
    </>
  );

  if (!expandable) {
    return (
      <div className={`collapsible ${className}`.trim()}>
        <div className="collapsible-header collapsible-header-static">{header}</div>
        {children != null && <div className="collapsible-body-inner">{children}</div>}
      </div>
    );
  }

  return (
    <details className={`collapsible ${className}`.trim()} open={defaultOpen}>
      <summary className="collapsible-header">{header}</summary>
      {children != null && <div className="collapsible-body-inner">{children}</div>}
    </details>
  );
}
