// The EMD / PBG history as a side panel that slides in from the right —
// same frame as the chat widget (ar-chat-popup), opened from the
// "Timeline" button on the EMD / PBG card instead of a list at the bottom.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ROLE_LABELS } from "../../lib/roles";
import { FINANCE_EVENT_LABELS } from "../../lib/proposalPrep";
import { CloseIcon } from "../icons";
import "../../styles/ApplicationReviewPage.css";

function fmtTime(v) {
  return new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const SCOPE_LABEL = { emd: "EMD", pbg: "PBG Note", fee_payment: "Payment" };

export default function FinanceTimelineDrawer({ title = "Timeline", events, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Newest first — what just happened is what people open this for.
  const list = [...(events || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return createPortal(
    <div className="ar-chat-popup pp-tl-drawer" role="dialog" aria-label={title} ref={ref}>
      <div className="ar-chat-popup-header">
        <span className="ar-chat-popup-title">{title}</span>
        <div className="ar-chat-popup-actions">
          <button type="button" className="ar-chat-icon-btn" aria-label="Close timeline" title="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="pp-tl-list">
        {list.length === 0 ? (
          <p className="ar-empty-text">Nothing has happened yet.</p>
        ) : (
          <ol className="pp-tl">
            {list.map((ev) => {
              const role = ROLE_LABELS[ev.actor?.role] || ev.actor?.role;
              return (
                <li key={ev.id} className={`pp-tl-item pp-tl-${ev.scope}`}>
                  <span className="pp-tl-dot" aria-hidden="true" />
                  <div className="pp-tl-body">
                    <div className="pp-tl-top">
                      <span className="pp-tl-scope">{SCOPE_LABEL[ev.scope] || ev.scope}</span>
                      <time className="pp-tl-time">{fmtTime(ev.created_at)}</time>
                    </div>
                    <strong className="pp-tl-action">{FINANCE_EVENT_LABELS[ev.action] || ev.action.replace(/_/g, " ")}</strong>
                    <span className="pp-tl-actor">
                      {ev.actor?.full_name || "System"}
                      {role && <span className="pp-tl-role"> · {role}</span>}
                    </span>
                    {ev.remark && <p className="pp-tl-remark">{ev.remark}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>,
    document.body
  );
}
