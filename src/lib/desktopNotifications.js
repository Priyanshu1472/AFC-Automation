// Native desktop (browser) notifications for PMIS — WhatsApp-Web style.
//
// Not a second notification system. Two delivery paths, one pop-up:
//   • Live (PMIS tab open): the existing per-user Realtime channel in
//     notifications.js calls handleRealtimeNotification() once per event
//     per tab.
//   • Web Push (PMIS tab closed too): a database trigger on notifications
//     calls the send-push edge function, and the service worker (src/sw.js)
//     shows the pop-up. See pushSubscription.js.
// Both build the pop-up with buildDesktopPayload() and the same tag, and the
// page defers to a push that already showed an event — so it pops once.
//
// Two separate switches, both required:
//   • browser permission — Notification.permission, owned by the browser
//   • user preference    — "does this person want PMIS desktop alerts",
//                          kept per user, per browser (localStorage). On by
//                          default: allowing the browser permission is the
//                          opt-in; only an explicit "Turn off" disables it.

import { buildDesktopPayload, eventKey, notificationTag } from "./desktopNotificationPayload";

export { buildDesktopPayload, eventKey, DESKTOP_ICON } from "./desktopNotificationPayload";

const PREF_KEY = (userId) => `pmis-desktop-notifications:${userId}`;
const PROMPT_KEY = (userId) => `pmis-desktop-notifications-prompted:${userId}`;
const SEEN_KEY = "pmis-desktop-notifications-seen";
const SEEN_MAX = 300;
// Realtime only delivers live changes, so a row older than this is not a
// fresh event (e.g. an unrelated UPDATE to an old row). Generous enough to
// absorb a client clock that's a few minutes off.
const MAX_AGE_MS = 10 * 60 * 1000;
// With Web Push active the push normally shows the pop-up; the live path
// waits this long and only steps in if the push never arrived.
const PUSH_GRACE_MS = 4000;

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

// Both switches on: the browser allows it and the person wants it.
export function isDesktopActive(userId) {
  return getDesktopPermission() === "granted" && getDesktopPreference(userId);
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

// ── Web Push coordination ─────────────────────────────────────────────────

let pushActive = false;

// Set by pushSubscription.js once this browser is registered for Web Push.
export function setPushActive(active) {
  pushActive = !!active;
}

export function isPushActive() {
  return pushActive;
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

function openNotification(id, link) {
  try {
    window.focus();
  } catch {
    /* ignore */
  }
  if (id != null && markRead) markRead(id).catch(() => {});
  if (link) {
    if (navigateTo) navigateTo(link);
    else window.location.assign(link);
  }
}

// ── Deciding what's genuinely new ─────────────────────────────────────────

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

function markSeen(key) {
  seenThisTab.add(key);
  const seen = readSeen();
  if (seen.includes(key)) return false;
  seen.push(key);
  storageSet(SEEN_KEY, JSON.stringify(seen.slice(-SEEN_MAX)));
  return true;
}

// Records the key across tabs; returns false if another tab already did.
function claim(key) {
  if (seenThisTab.has(key)) return false;
  return markSeen(key);
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

// ── Service worker ↔ page ─────────────────────────────────────────────────

async function getSwRegistration() {
  try {
    return (await navigator.serviceWorker?.getRegistration()) || null;
  } catch {
    return null;
  }
}

if (typeof navigator !== "undefined" && navigator.serviceWorker?.addEventListener) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    const msg = e.data || {};
    // A push already showed this event — don't pop it again from here.
    if (msg.type === "pmis-push-shown" && msg.key) markSeen(msg.key);
    // The person clicked a pop-up the service worker showed.
    if (msg.type === "pmis-notification-click") openNotification(msg.id, msg.link);
  });
  navigator.serviceWorker.startMessages?.();
}

async function alreadyShownByPush(row) {
  if (seenThisTab.has(eventKey(row))) return true;
  const reg = await getSwRegistration();
  if (!reg?.getNotifications) return false;
  try {
    const open = await reg.getNotifications({ tag: notificationTag(row) });
    return open.some((n) => n.data?.key === eventKey(row));
  } catch {
    return false;
  }
}

// ── Showing it ────────────────────────────────────────────────────────────

async function showDesktopNotification(row) {
  const { title, options } = buildDesktopPayload(row);
  // Through the service worker when there is one: its pop-ups survive the
  // tab being closed, its click handler (src/sw.js) opens PMIS, and it's
  // the only way Chrome on Android allows pop-ups at all.
  const reg = await getSwRegistration();
  if (reg?.showNotification) {
    try {
      await reg.showNotification(title, options);
      return;
    } catch {
      /* fall through to the page-level API */
    }
  }
  let n;
  try {
    n = new window.Notification(title, options);
  } catch {
    return;
  }
  n.onclick = (e) => {
    e.preventDefault?.();
    n.close();
    openNotification(row.id, row.link);
  };
}

// Called by notifications.js once per Realtime event on a user's channel.
export async function handleRealtimeNotification(userId, row) {
  if (!row || !userId || (row.user_id && row.user_id !== userId)) return;
  if (!isFreshUnread(row)) return;
  const key = eventKey(row);
  if (seenThisTab.has(key)) return;
  if (!isDesktopActive(userId)) return;

  if (pushActive) {
    await new Promise((r) => setTimeout(r, PUSH_GRACE_MS));
    if (await alreadyShownByPush(row)) return;
  }

  // Every new notification pops up — also while PMIS is the focused tab —
  // but only once, however many PMIS tabs are open.
  const won = await claimAcrossTabs(key);
  if (won) await showDesktopNotification(row);
}
