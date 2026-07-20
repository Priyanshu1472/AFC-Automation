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

// Subscribes to INSERT events for this user only. Returns an unsubscribe
// function for cleanup in a useEffect.
export function subscribeToNotifications(userId, onInsert) {
  const channel = supabase
    .channel(`notifications-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
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
