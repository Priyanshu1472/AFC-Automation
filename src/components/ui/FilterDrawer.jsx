import Button from "./Button";
import "../../styles/FilterDrawer.css";

const IconFilter = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>;

// Shared "Filters" trigger button — shows the active-filter count as a badge.
// Standardized across the app to match the Empanelment Reports page pattern:
// a button opens a right-side slide-in drawer, the user selects filters
// there, then applies/closes it. Text-only on desktop; collapses to a
// compact icon-only square button on mobile (see FilterDrawer.css) — never
// both at once, so it doesn't read as a wide, mostly-empty pill.
export function FilterButton({ onClick, activeCount = 0, className = "" }) {
  return (
    <Button variant="secondary" onClick={onClick} className={`fd-filter-btn ${className}`.trim()} aria-label="Filters">
      <span className="fd-filter-icon" aria-hidden="true">{IconFilter}</span>
      <span className="fd-filter-text">Filters</span>
      {activeCount > 0 && <span className="fd-filter-count">{activeCount}</span>}
    </Button>
  );
}

// Shared right-side slide-in filter drawer. Pass filter controls as
// children — each control should be wrapped in <FilterField label="…">.
export default function FilterDrawer({ open, onClose, onReset, children, title = "Filters" }) {
  if (!open) return null;
  return (
    <>
      <div className="fd-backdrop" onClick={onClose} />
      <div className="fd-drawer" role="dialog" aria-label={title}>
        <div className="fd-header">
          <span className="fd-title">{IconFilter} {title}</span>
          <button type="button" className="fd-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="fd-body">{children}</div>
        <div className="fd-footer">
          <Button variant="primary" block onClick={onClose}>Done</Button>
          {onReset && <Button variant="secondary" block onClick={onReset}>Reset</Button>}
        </div>
      </div>
    </>
  );
}

export function FilterField({ label, children }) {
  return (
    <div className="fd-field">
      <label className="fd-label">{label}</label>
      {children}
    </div>
  );
}
