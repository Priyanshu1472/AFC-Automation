import { useState } from "react";
import { ROLE_LABELS } from "../../lib/roles";
// Reuses the ar-accordion/ar-acc-* timeline styles already defined for
// Empanelment's activity log (see ApplicationTimeline.jsx) — a generic
// accordion pattern, not Empanelment-specific markup or behavior.
import "../../styles/ApplicationReviewPage.css";

export default function LeadTimeline({ logs }) {
  const [openId, setOpenId] = useState(null);

  if (!logs || logs.length === 0) return <p className="ar-empty-text">No activity yet.</p>;

  return (
    <div className="ar-accordion">
      {logs.map((log) => {
        const isOpen = openId === log.id;
        const time = new Date(log.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        const roleLabel = ROLE_LABELS[log.actor_role] || log.actor_role;
        return (
          <div key={log.id} className={`ar-acc-item${isOpen ? " ar-acc-item-open" : ""}`}>
            <button className="ar-acc-header" onClick={() => setOpenId(isOpen ? null : log.id)} aria-expanded={isOpen}>
              <div className="ar-acc-dot" />
              <div className="ar-acc-meta">
                <span className="ar-acc-name">
                  {log.actor?.full_name || "System"}
                  <span className="ar-acc-role"> ({roleLabel})</span>
                </span>
                <span className="ar-acc-action">{log.action.replace(/_/g, " ").toUpperCase()}</span>
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
                {log.from_status && log.to_status && (
                  <p className="ar-acc-comment">{log.from_status.replace(/_/g, " ")} → {log.to_status.replace(/_/g, " ")}</p>
                )}
                {log.comment ? <p className="ar-acc-comment">&quot;{log.comment}&quot;</p> : <p className="ar-acc-no-comment">No comment added.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
