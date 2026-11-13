import { supabase } from "./supabase";

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
const notificationChannels = new Map(); // userId -> { channel, listeners: Set }

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
    const notify = (payload) => listeners.forEach((fn) => fn(payload.new));
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, notify)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, notify)
      .subscribe();
    entry = { channel, listeners };
    notificationChannels.set(userId, entry);
  }

  entry.listeners.add(onChange);

  return () => {
    entry.listeners.delete(onChange);
    if (entry.listeners.size === 0) {
      notificationChannels.delete(userId);
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
