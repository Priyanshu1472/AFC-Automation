import { useState } from "react";
import { ROLE_LABELS } from "../../lib/roles";
import { FINANCE_EVENT_LABELS } from "../../lib/proposalPrep";
// Reuses the ar-accordion/ar-acc-* timeline styles already defined for
// Lead Generation/Empanelment's own activity log (see LeadTimeline.jsx/
// ApplicationTimeline.jsx) — a generic accordion pattern, not specific to
// either of those modules.
import "../../styles/ApplicationReviewPage.css";

export default function FinanceTimeline({ events }) {
  const [openId, setOpenId] = useState(null);

  if (!events || events.length === 0) return <p className="ar-empty-text">No activity yet.</p>;

  return (
    <div className="ar-accordion">
      {events.map((ev) => {
        const isOpen = openId === ev.id;
        const time = new Date(ev.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        const roleLabel = ROLE_LABELS[ev.actor?.role] || ev.actor?.role;
        return (
          <div key={ev.id} className={`ar-acc-item${isOpen ? " ar-acc-item-open" : ""}`}>
            <button className="ar-acc-header" onClick={() => setOpenId(isOpen ? null : ev.id)} aria-expanded={isOpen}>
              <div className="ar-acc-dot" />
              <div className="ar-acc-meta">
                <span className="ar-acc-name">
                  {ev.actor?.full_name || "System"}
                  {roleLabel && <span className="ar-acc-role"> ({roleLabel})</span>}
                </span>
                <span className="ar-acc-action">{FINANCE_EVENT_LABELS[ev.action] || ev.action.replace(/_/g, " ").toUpperCase()}</span>
              </div>
              <div className="ar-acc-right">
                <span className="ar-acc-time">{time}</span>
                <span className={`ar-acc-chevron${isOpen ? " ar-acc-chevron-open" : ""}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
                </span>
              </div>
            </button>
            {isOpen && (
              <div className="ar-acc-body">
                {ev.remark ? <p className="ar-acc-comment">&quot;{ev.remark}&quot;</p> : <p className="ar-acc-no-comment">No remark added.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
