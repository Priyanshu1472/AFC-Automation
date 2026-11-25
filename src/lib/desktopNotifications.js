// Native desktop (browser) notifications for PMIS — WhatsApp-Web style.
//
// Not a second notification system: it rides on the existing per-user
// Realtime channel in notifications.js, which calls
// handleRealtimeNotification() once per event per tab. This module only
// decides whether that event deserves an OS pop-up and shows it.
//
// Two separate switches, both required:
//   • browser permission — Notification.permission, owned by the browser
//   • user preference    — "does this person want PMIS desktop alerts",
//                          kept per user, per browser (localStorage). On by
//                          default: allowing the browser permission is the
//                          opt-in; only an explicit "Turn off" disables it.
//
// Future Web Push: showDesktopNotification() is the single place that turns
// a notifications row into a pop-up (buildDesktopPayload is pure). A service
// worker's "push" handler can reuse buildDesktopPayload and call
// registration.showNotification() with the same tag, so the two paths never
// double up.

import { describeNotification } from "./notificationDisplay";

const PREF_KEY = (userId) => `pmis-desktop-notifications:${userId}`;
const PROMPT_KEY = (userId) => `pmis-desktop-notifications-prompted:${userId}`;
const SEEN_KEY = "pmis-desktop-notifications-seen";
const SEEN_MAX = 300;
// Realtime only delivers live changes, so a row older than this is not a
// fresh event (e.g. an unrelated UPDATE to an old row). Generous enough to
// absorb a client clock that's a few minutes off.
const MAX_AGE_MS = 10 * 60 * 1000;
export const DESKTOP_ICON = "/icons/icon-192.png";

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / storage blocked — preference just won't persist */
  }
}

// ── State shared by every component that shows the setting ────────────────

const listeners = new Set();
function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeDesktopState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isDesktopSupported() {
  return typeof window !== "undefined" && "Notification" in window && window.isSecureContext !== false;
}

// "granted" | "denied" | "default" | "unsupported"
export function getDesktopPermission() {
  return isDesktopSupported() ? window.Notification.permission : "unsupported";
}

export function getDesktopPreference(userId) {
  return !!userId && storageGet(PREF_KEY(userId)) !== "off";
}

export function setDesktopPreference(userId, enabled) {
  if (!userId) return;
  storageSet(PREF_KEY(userId), enabled ? "on" : "off");
  emit();
}

// The one-time "turn on desktop notifications?" prompt: shown only while
// the browser hasn't been asked yet and this user hasn't answered it.
export function shouldOfferDesktopPrompt(userId) {
  return (
    !!userId &&
    getDesktopPermission() === "default" &&
    storageGet(PREF_KEY(userId)) !== "off" &&
    storageGet(PROMPT_KEY(userId)) == null
  );
}

export function dismissDesktopPrompt(userId) {
  if (!userId) return;
  storageSet(PROMPT_KEY(userId), "1");
  emit();
}

// Must run from a click (browsers ignore permission requests otherwise).
// Turns the preference on only when the browser actually allows it.
export async function enableDesktopNotifications(userId) {
  if (!isDesktopSupported() || !userId) return "unsupported";
  storageSet(PROMPT_KEY(userId), "1");
  let permission = window.Notification.permission;
  if (permission === "default") {
    try {
      permission = await window.Notification.requestPermission();
    } catch {
      permission = window.Notification.permission;
    }
  }
  if (permission === "granted") storageSet(PREF_KEY(userId), "on");
  emit();
  return permission;
}

// Re-render settings if the person changes the permission in the browser's
// site settings while PMIS is open.
if (isDesktopSupported() && navigator.permissions?.query) {
  navigator.permissions
    .query({ name: "notifications" })
    .then((status) => {
      status.onchange = emit;
    })
    .catch(() => {});
}

// ── Click → navigation (wired by the app shell, which owns the router) ────

let navigateTo = null;
let markRead = null;

export function setDesktopNotificationHandlers({ navigate, markNotificationRead }) {
  navigateTo = navigate || null;
  markRead = markNotificationRead || null;
  return () => {
    if (navigateTo === navigate) navigateTo = null;
  };
}

// ── Deciding what's genuinely new ─────────────────────────────────────────

// A grouped chat notification re-arrives as an UPDATE with a fresh
// created_at for every new message (bump_chat_notification), so id +
// created_at identifies one deliverable event; read-flips keep created_at.
export function eventKey(row) {
  return `${row.id}@${row.created_at}`;
}

export function isFreshUnread(row, now = Date.now()) {
  if (!row?.id || row.is_read) return false;
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  return now - created <= MAX_AGE_MS;
}

const seenThisTab = new Set();

function readSeen() {
  try {
    const parsed = JSON.parse(storageGet(SEEN_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Records the key across tabs; returns false if another tab already did.
function claim(key) {
  if (seenThisTab.has(key)) return false;
  seenThisTab.add(key);
  const seen = readSeen();
  if (seen.includes(key)) return false;
  seen.push(key);
  storageSet(SEEN_KEY, JSON.stringify(seen.slice(-SEEN_MAX)));
  return true;
}

// Serialise the claim across tabs so two open PMIS tabs can't both pop the
// same event (Web Locks in Chrome/Edge; plain claim elsewhere).
function claimAcrossTabs(key) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks
      .request("pmis-desktop-notifications", () => claim(key))
      .catch(() => claim(key));
  }
  return Promise.resolve(claim(key));
}

// ── Showing it ────────────────────────────────────────────────────────────

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
      tag: `pmis-notification-${row.id}`,
      renotify: true,
      timestamp: new Date(row.created_at).getTime(),
      data: { id: row.id, link: row.link || null },
    },
  };
}

function showDesktopNotification(row) {
  const { title, options } = buildDesktopPayload(row);
  let n;
  try {
    n = new window.Notification(title, options);
  } catch {
    // Mobile Chrome only allows notifications from a service worker; the
    // in-app bell still has the notification, so just skip the pop-up.
    return;
  }
  n.onclick = (e) => {
    e.preventDefault?.();
    try {
      window.focus();
    } catch {
      /* ignore */
    }
    n.close();
    if (markRead) markRead(row.id).catch(() => {});
    if (row.link) {
      if (navigateTo) navigateTo(row.link);
      else window.location.assign(row.link);
    }
  };
}

// Called by notifications.js once per Realtime event on a user's channel.
export async function handleRealtimeNotification(userId, row) {
  if (!row || !userId || row.user_id && row.user_id !== userId) return;
  if (!isFreshUnread(row)) return;
  const key = eventKey(row);
  if (seenThisTab.has(key)) return;

  // Every new notification pops up — also while PMIS is the focused tab —
  // but only once, however many PMIS tabs are open.
  if (getDesktopPermission() !== "granted" || !getDesktopPreference(userId)) return;
  const won = await claimAcrossTabs(key);
  if (won) showDesktopNotification(row);
}
