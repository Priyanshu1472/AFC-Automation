// Web Push registration for this browser, so desktop notifications arrive
// even when no PMIS tab is open (the browser itself must be running).
//
// The browser's push subscription (one per browser profile + site) is saved
// server-side against the signed-in user by the push-subscription edge
// function; a database trigger on notifications then has send-push deliver
// each new notification to that user's subscriptions, and src/sw.js shows it.
//
// Wrong-user safety: a subscription belongs to exactly one user — saving it
// while signed in as someone else moves it to them, and signing out (or
// turning desktop notifications off) deletes it.

import { supabase } from "./supabase";
import { isDesktopActive, setPushActive } from "./desktopNotifications";

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function base64UrlToBytes(b64url) {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function bytesToBase64Url(buf) {
  const bin = String.fromCharCode(...new Uint8Array(buf));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function invoke(body) {
  return supabase.functions.invoke("push-subscription", { body });
}

// Only a registration that's actually live (the production build — the Vite
// dev server has no service worker).
async function getRegistration() {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

let publicKey = null;
async function getPublicKey() {
  if (publicKey) return publicKey;
  const { data, error } = await invoke({ action: "key" });
  if (error || !data?.public_key) return null;
  publicKey = data.public_key;
  return publicKey;
}

// Remembers the last state saved for this tab, so remounting the app shell
// on every page change doesn't call the server again.
let lastSynced = null;
let queue = Promise.resolve();

function serialise(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function doSync(userId) {
  const reg = await getRegistration();
  if (!reg || !userId) {
    setPushActive(false);
    return false;
  }
  let sub = await reg.pushManager.getSubscription();

  if (!isDesktopActive(userId)) {
    if (sub) {
      await invoke({ action: "unsubscribe", endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    lastSynced = null;
    setPushActive(false);
    return false;
  }

  const key = await getPublicKey();
  if (!key) {
    // Push isn't configured on this environment — live pop-ups still work.
    setPushActive(false);
    return false;
  }

  // A subscription made with an older server key can't be pushed to.
  const subKey = sub?.options?.applicationServerKey;
  if (sub && subKey && bytesToBase64Url(subKey) !== key) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) });
  }

  const marker = `${userId}|${sub.endpoint}`;
  if (lastSynced === marker) {
    setPushActive(true);
    return true;
  }
  const { error } = await invoke({
    action: "subscribe",
    subscription: sub.toJSON(),
    user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) {
    setPushActive(false);
    return false;
  }
  lastSynced = marker;
  setPushActive(true);
  return true;
}

// Bring this browser's push registration in line with the current user's
// desktop-notification switches (subscribe, move to this user, or remove).
export function syncPushSubscription(userId) {
  return serialise(() => doSync(userId).catch(() => {
    setPushActive(false);
    return false;
  }));
}

// On sign-out: stop pushing this user's notifications to this browser.
// Bounded so a slow network never holds up signing out.
export function removePushSubscription() {
  const work = serialise(async () => {
    lastSynced = null;
    setPushActive(false);
    const reg = await getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await invoke({ action: "unsubscribe", endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }).catch(() => {});
  return Promise.race([work, new Promise((r) => setTimeout(r, 3000))]);
}
