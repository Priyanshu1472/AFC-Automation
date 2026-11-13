import { splitQuoted } from "../../lib/notificationDisplay";
import "../../styles/NotificationBell.css";

// The "details" part of an alert, laid out the same way everywhere (Home
// table and notification panel): the lead title / organisation in bold on
// one line, then what happened underneath (clamped by the caller's CSS),
// with any quoted text — usually a chat message — emphasised.
// `d` is the result of describeNotification().
export default function NotificationDetail({ d, className = "" }) {
  if (!d.subject && !d.detail) return <span className={className}>—</span>;
  return (
    <span className={`notif-detail ${className}`}>
      {d.subject && <strong className="notif-detail-subject" title={d.subject}>{d.subject}</strong>}
      {d.detail && (
        <span className="notif-detail-text">
          {splitQuoted(d.detail).map((p, i) => (p.quoted ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}
        </span>
      )}
    </span>
  );
}
