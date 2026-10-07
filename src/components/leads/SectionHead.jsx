// Numbered section header used by the lead forms (Add/Edit Lead, Lead
// Approval Note) — styles in styles/LeadForm.css.
export default function SectionHead({ step, title, subtitle, action }) {
  return (
    <div className="lf-section-head">
      <span className="lf-step" aria-hidden="true">{step}</span>
      <div className="lf-section-head-text">
        <h2 className="lf-section-title">{title}</h2>
        {subtitle && <p className="lf-section-sub">{subtitle}</p>}
      </div>
      {action && <div className="lf-section-action">{action}</div>}
    </div>
  );
}
