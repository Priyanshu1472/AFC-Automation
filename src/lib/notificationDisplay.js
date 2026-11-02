// Splits a notification's free-text title/sub_text into consistent parts for
// display, so every alert reads the same way in the Home table and the
// notification panel no matter how its edge function worded it:
//
//   alert   — the short headline ("Lead awaiting PMT review", "New messages")
//   ref     — the lead number, when the alert is about a lead
//   subject — the lead's title, or the BP organisation for empanelment
//   detail  — what happened, with the lead number/title/organisation taken
//             out (they're shown separately)
//
// Works on the stored text (no extra columns), so it applies to old
// notifications too. Anything it doesn't recognise passes through as-is.

// "AFC/TEAM 2/L/26/022", optionally followed by — "Lead title". The title's
// closing quote is the one followed by how the edge functions continue the
// sentence (needs / was / has / is / from / to / "(team)" / end), so a
// title that itself contains quotes still parses.
const LEAD_RE = /(AFC\/[^/"]+\/L\/\d{2}\/\d+)(?:\s*—\s*"(.*?)"(?=\s+(?:needs|was|has|is|from|to)\b|\s*\(|\s*$|[.:]))?/;

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function stripLead(text) {
  const m = LEAD_RE.exec(text);
  if (!m) return text;
  const before = text.slice(0, m.index);
  let after = text.slice(m.index + m[0].length);
  if (!before.trim()) {
    // "{lead} — "t" (Team 1): a query was raised." → "A query was raised."
    after = after.replace(/^\s*\([^)]*\)/, "").replace(/^\s*[:—–-]?\s*/, "");
    return cap(after.trim());
  }
  // "New messages on {lead} — "t"" → "New messages"
  if (!after.trim()) return before.replace(/\s+(on|for)\s*$/i, "").trim();
  return `${before}this lead${after}`.trim();
}

// Where an empanelment notification names the BP organisation.
const ORG_PATTERNS = [
  / on (.+?)'s empanelment application$/, // chat titles
  /^(.+?)'s (?:application|empanelment application)/,
  /\b(?:send|approved|on) (.+?)'s (?:provisional|application)/,
  /^(.+?) has submitted/,
  /\bprovisional letter for (.+?): /,
];

function findOrg(text) {
  for (const re of ORG_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return null;
}

function stripOrg(text, org) {
  if (!org || !text.includes(org)) return text;
  let out = text
    .replace(` on ${org}'s empanelment application`, "")
    .split(`${org}'s `).join("the ")
    .replace(`${org} has`, "The BP has")
    .split(org).join("this application");
  return cap(out.trim());
}

export function describeNotification(n) {
  const title = n?.title || "";
  const sub = n?.sub_text || "";

  const leadMatch = LEAD_RE.exec(sub) || LEAD_RE.exec(title);
  if (leadMatch) {
    const subject = leadMatch[2] || LEAD_RE.exec(title)?.[2] || null;
    return { alert: stripLead(title), ref: leadMatch[1], subject, detail: stripLead(sub) };
  }

  if ((n?.link || "").startsWith("/empanelment")) {
    const org = findOrg(sub) || findOrg(title);
    if (org) return { alert: stripOrg(title, org), ref: null, subject: org, detail: stripOrg(sub, org) };
  }

  return { alert: title, ref: null, subject: null, detail: sub };
}

// Splits text so quoted parts (a chat message, a lead title left in the
// sentence) can be emphasised: [{ text, quoted }].
export function splitQuoted(text) {
  if (!text) return [];
  return text
    .split(/("[^"]+")/)
    .filter(Boolean)
    .map((part) => ({ text: part, quoted: /^".+"$/.test(part) }));
}
