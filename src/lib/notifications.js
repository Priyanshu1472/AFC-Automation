import { supabase } from "./supabase";
import { handleRealtimeNotification } from "./desktopNotifications";

export async function fetchRecentNotifications(userId, limit = 20) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, sub_text, type, link, is_read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Unread, action_required notifications only — the "needs your action" list
// shown on Home. Once a notification is marked read (e.g. by opening the
// application it links to), it drops off this list.
export async function fetchPendingActionNotifications(userId, limit = 10) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, sub_text, type, link, is_read, created_at")
    .eq("user_id", userId)
    .eq("type", "action_required")
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// NotificationBell and PendingActionsPanel both subscribe for the same
// user at the same time (they mount together on Home). Supabase reuses a
// channel object for a given topic instead of creating a second one, so a
// naive "channel().on().subscribe()" per caller throws the second time
// ("cannot add postgres_changes callbacks ... after subscribe()"). Instead,
// keep one real channel per user here and fan its events out to every
// caller, ref-counting so the channel is torn down once the last caller
// unsubscribes.
const notificationChannels = new Map(); // userId -> { channel, listeners: Set, cleanup }

// When this tab first subscribed for each user (page load / sign-in). A
// desktop catch-up never reaches further back than this, so notifications
// that already existed at sign-in never pop up as new.
const firstSubscribedAt = new Map(); // userId -> ISO string
const CATCH_UP_WINDOW_MS = 10 * 60 * 1000;

// Realtime only delivers events while the socket is connected. A background
// tab can drop it (Chrome throttles/freezes hidden tabs), and a page change
// briefly tears the channel down — so on every (re)subscribe, and when the
// tab comes back to the foreground, re-check for unread notifications that
// arrived in the meantime and hand them to the desktop notifier only (it
// skips anything already shown). The in-app lists are left exactly as they
// were.
async function catchUpDesktop(userId) {
  const since = Math.max(Date.parse(firstSubscribedAt.get(userId)), Date.now() - CATCH_UP_WINDOW_MS);
  const { data, error } = await supabase
    .from("notifications")
    .select("id, user_id, title, sub_text, type, link, is_read, created_at")
    .eq("user_id", userId)
    .eq("is_read", false)
    .gt("created_at", new Date(since).toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  if (error || !data) return;
  for (const row of data) await handleRealtimeNotification(userId, row);
}

// Subscribes to INSERT and UPDATE events for this user only — UPDATE
// matters because a grouped chat-message notification (see
// bump_chat_notification) doesn't insert a new row for the 2nd+ message in
// a batch, it updates the existing unread one's count in place, and
// mark_*_chat_read also flips existing rows to is_read via UPDATE rather
// than deleting them. Both event types hand the listener the same shape
// (the row as it now stands), so callers can treat every call as "here's
// this notification's current state" and upsert-by-id rather than caring
// which kind of change produced it.
export function subscribeToNotifications(userId, onChange) {
  let entry = notificationChannels.get(userId);

  if (!entry) {
    const listeners = new Set();
    const notify = (payload) => {
      listeners.forEach((fn) => fn(payload.new));
      // Once per event per tab (not per listener) — the desktop pop-up
      // decides for itself whether the event is genuinely new.
      handleRealtimeNotification(userId, payload.new).catch(() => {});
    };
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, notify)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, notify)
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (!firstSubscribedAt.has(userId)) firstSubscribedAt.set(userId, new Date().toISOString());
        else catchUpDesktop(userId).catch(() => {});
      });
    const onVisible = () => {
      if (document.visibilityState === "visible" && firstSubscribedAt.has(userId)) catchUpDesktop(userId).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    entry = { channel, listeners, cleanup: () => document.removeEventListener("visibilitychange", onVisible) };
    notificationChannels.set(userId, entry);
  }

  entry.listeners.add(onChange);

  return () => {
    entry.listeners.delete(onChange);
    if (entry.listeners.size === 0) {
      notificationChannels.delete(userId);
      entry.cleanup();
      supabase.removeChannel(entry.channel);
    }
  };
}

export async function markNotificationRead(id) {
  const { error } = await supabase.rpc("mark_notification_read", { notification_id: id });
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const { error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw error;
}
