function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Splits chat message text into plain strings and highlighted "@Full Name"
// spans for every participant whose name appears, tagged or not — this is
// display-only (the actual notified-recipient list comes from the sender's
// edge function, computed off the id-based mentions tracked at send time).
// Longest names are matched first so "@Ann" inside "@Anne Marie" can't
// steal a shorter prefix match.
export function renderWithMentions(text, participants) {
  if (!text) return text;
  const names = [...new Set((participants || []).map((p) => p.full_name).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;

  const pattern = new RegExp(`@(?:${names.map(escapeRegExp).join("|")})`, "g");
  const parts = [];
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <span className="ar-chat-mention" key={`mention-${key++}`}>
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
