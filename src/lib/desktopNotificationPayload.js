// Turns a notifications row into a desktop pop-up (title + options).
// Pure — no window/DOM — so the page (live Realtime pop-ups) and the
// service worker (Web Push, PMIS tab closed) build the exact same pop-up
// with the same tag, and one never doubles up the other.

import { describeNotification } from "./notificationDisplay";

export const DESKTOP_ICON = "/icons/icon-192.png";

// A grouped chat notification re-arrives with a fresh created_at for every
// new message (bump_chat_notification), so id + created_at identifies one
// deliverable event; read-flips keep created_at.
export function eventKey(row) {
  return `${row.id}@${row.created_at}`;
}

export function notificationTag(row) {
  return `pmis-notification-${row.id}`;
}

export function buildDesktopPayload(row) {
  const d = describeNotification(row);
  const lines = [[d.ref, d.subject].filter(Boolean).join(" — "), d.detail].filter(Boolean);
  return {
    title: d.alert || "AFC PMIS",
    options: {
      body: lines.join("\n"),
      icon: DESKTOP_ICON,
      badge: DESKTOP_ICON,
      // One pop-up per notification row: a chat thread's newer message
      // replaces the older pop-up (and alerts again) instead of stacking.
      tag: notificationTag(row),
      renotify: true,
      timestamp: new Date(row.created_at).getTime(),
      data: { id: row.id, link: row.link || null, key: eventKey(row) },
    },
  };
}
