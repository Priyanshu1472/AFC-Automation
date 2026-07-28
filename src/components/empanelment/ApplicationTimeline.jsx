import { useState } from "react";
import { ROLE_LABELS } from "../../lib/roles";
import "../../styles/ApplicationReviewPage.css";

// actor_role can be "ba" for BA-originated activity log entries (e.g. a
// correction submission), which isn't a real staff role in ROLE_LABELS.
const ROLE_DISPLAY = { ...ROLE_LABELS, ba: "Business Associate" };

export const STATUS_FLOW = [
  { key: "sent", label: "Sent" },
  { key: "po_review", label: "PO" },
  { key: "cfo_cs_review", label: "CFO / CS" },
  { key: "po_final_review", label: "PO Final" },
  { key: "dgm_review", label: "DGM" },
  { key: "md_review", label: "MD" },
];

// Spelled-out labels for the public (no-login) status-check page — the
// abbreviations above are fine for AFC staff, who already know the review
// hierarchy, but confusing for a BA looking the process up cold.
const STATUS_FLOW_FULL_LABELS = {
  sent: "Sent",
  po_review: "Project Officer",
  cfo_cs_review: "Chief Financial Officer / Company Secretary",
  po_final_review: "Project Officer (Final Review)",
  dgm_review: "Deputy General Manager",
  md_review: "Managing Director",
};

export const STATUS_BADGE = {
  sent: "info", filled: "warning", po_review: "warning",
  cfo_cs_review: "info", po_final_review: "warning", dgm_review: "neutral",
  md_review: "neutral", accepted: "success", rejected: "danger", on_hold: "warning",
};

function CheckIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>; }
function XIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }

export function ProgressStepper({ currentStatus, publicView = false }) {
  const keys = STATUS_FLOW.map((s) => s.key);
  const isAccepted = currentStatus === "accepted";
  const isRejected = currentStatus === "rejected";
  const isHold = currentStatus === "on_hold";
  const currentIdx = isAccepted || isRejected ? keys.length - 1 : keys.indexOf(currentStatus);

  return (
    <div className={`ar-stepper${publicView ? " ar-stepper-public" : ""}`}>
      {STATUS_FLOW.map((step, i) => {
        const isDone = isAccepted || (!isHold && i < currentIdx);
        const isCurrent = !isAccepted && !isRejected && !isHold && i === currentIdx;
        const isRejectedStep = isRejected && i === currentIdx;
        return (
          <div key={step.key} className={`ar-step-outer${isDone ? " ar-step-done-outer" : ""}`}>
            <div className="ar-step">
              <div className={["ar-step-dot", isRejectedStep ? "ar-step-rejected" : "", isCurrent ? "ar-step-current" : "", isDone ? "ar-step-done" : ""].filter(Boolean).join(" ")}>
                {isRejectedStep ? <XIcon /> : isDone || isAccepted ? <CheckIcon /> : null}
              </div>
              <span className={["ar-step-label", isRejectedStep ? "ar-step-label-rejected" : "", isCurrent ? "ar-step-label-current" : "", isDone ? "ar-step-label-done" : ""].filter(Boolean).join(" ")}>{publicView ? STATUS_FLOW_FULL_LABELS[step.key] : step.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TimelineAccordion({ logs, showActorName = true }) {
  const [openId, setOpenId] = useState(null);
  if (logs.length === 0) return <p className="ar-empty-text">No activity yet.</p>;
  return (
    <div className="ar-accordion">
      {logs.map((log) => {
        const isOpen = openId === log.id;
        const time = new Date(log.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        const roleLabel = ROLE_DISPLAY[log.actor_role] || log.actor_role;
        return (
          <div key={log.id} className={`ar-acc-item${isOpen ? " ar-acc-item-open" : ""}`}>
            <button className="ar-acc-header" onClick={() => setOpenId(isOpen ? null : log.id)} aria-expanded={isOpen}>
              <div className="ar-acc-dot" />
              <div className="ar-acc-meta">
                <span className="ar-acc-name">
                  {showActorName ? (log.actor?.full_name || "Business Associate") : roleLabel}
                  {showActorName && <span className="ar-acc-role"> ({roleLabel})</span>}
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
            {isOpen && <div className="ar-acc-body">{log.comment ? <p className="ar-acc-comment">&quot;{log.comment}&quot;</p> : <p className="ar-acc-no-comment">No comment added.</p>}</div>}
          </div>
        );
      })}
    </div>
  );
}
