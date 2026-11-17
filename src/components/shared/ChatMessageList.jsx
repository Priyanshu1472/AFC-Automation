// Message list shared by the lead and proposal chat widgets. Regular
// messages are bubbles; a roster change (system_kind "member_added",
// posted by the DB trigger whenever someone joins — see
// 20261118010000_chat_member_added_lines.sql) is a small centred line with
// its time, like WhatsApp's "X added Y". A day divider separates days.
import { renderWithMentions } from "../../lib/mentions";

function fmtTime(v) {
  return new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function fmtDay(v) {
  const d = new Date(v);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function ChatMessageList({ messages, participants, selfId, loading, bottomRef }) {
  const names = Object.fromEntries(participants.map((p) => [p.user_id, p.full_name]));

  let lastDay = null;
  return (
    <div className="ar-chat-messages">
      {loading ? (
        <p className="ar-empty-text">Loading messages…</p>
      ) : messages.length === 0 ? (
        <p className="ar-empty-text">No messages yet.</p>
      ) : (
        messages.map((m) => {
          const day = new Date(m.created_at).toDateString();
          const divider = day !== lastDay ? <div className="ar-chat-day" key={`d-${m.id}`}><span>{fmtDay(m.created_at)}</span></div> : null;
          lastDay = day;

          if (m.system_kind) {
            return [
              divider,
              <div key={m.id} className="ar-chat-system" role="note">
                <span className="ar-chat-system-text">{m.message}</span>
                <span className="ar-chat-system-time">{fmtTime(m.created_at)}</span>
              </div>,
            ];
          }

          const isOwn = !!selfId && m.sender_id === selfId;
          return [
            divider,
            <div key={m.id} className={`ar-chat-msg${isOwn ? " ar-chat-msg-own" : ""}`}>
              <div className="ar-chat-bubble">
                {/* A null sender_id without a system_kind is an older
                    bot announcement (e.g. a G3 escalation notice). */}
                <span className="ar-chat-sender">{m.sender_id ? names[m.sender_id] || "Unknown" : "AFC Bot"}</span>
                <p className="ar-chat-text">{renderWithMentions(m.message, participants)}</p>
                <span className="ar-chat-time">{fmtTime(m.created_at)}</span>
              </div>
            </div>,
          ];
        })
      )}
      <div ref={bottomRef} />
    </div>
  );
}
