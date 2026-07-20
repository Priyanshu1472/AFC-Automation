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

// Subscribes to INSERT events for this user only. Returns an unsubscribe
// function for cleanup in a useEffect.
export function subscribeToNotifications(userId, onInsert) {
  let entry = notificationChannels.get(userId);

  if (!entry) {
    const listeners = new Set();
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => listeners.forEach((fn) => fn(payload.new))
      )
      .subscribe();
    entry = { channel, listeners };
    notificationChannels.set(userId, entry);
  }

  entry.listeners.add(onInsert);

  return () => {
    entry.listeners.delete(onInsert);
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
