import { beforeEach, describe, expect, it, vi } from "vitest";

const on = vi.fn();
const subscribe = vi.fn();
const channel = vi.fn();
const removeChannel = vi.fn();
const rpc = vi.fn();
const order = vi.fn();

vi.mock("./supabase", () => ({
  supabase: {
    channel: (...a) => channel(...a),
    removeChannel: (...a) => removeChannel(...a),
    rpc: (...a) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: (...a) => order(...a) }) }), order: () => ({ limit: (...a) => order(...a) }) }) }) }),
  },
}));

let notifications;

beforeEach(async () => {
  vi.clearAllMocks();
  // The module keeps a private Map of live channels keyed by user id —
  // reset the module registry so each test starts from a clean Map instead
  // of leaking subscriptions left open by a previous test.
  vi.resetModules();
  channel.mockReturnValue({ on: (...a) => { on(...a); return { subscribe } }, });
  subscribe.mockReturnValue("the-channel-handle");
  notifications = await import("./notifications");
});

describe("subscribeToNotifications ref-counting", () => {
  it("creates exactly one real channel for the first subscriber on a user", () => {
    notifications.subscribeToNotifications("user-1", vi.fn());
    expect(channel).toHaveBeenCalledTimes(1);
    expect(channel).toHaveBeenCalledWith("notifications-user-1");
  });

  it("reuses the same channel for a second subscriber on the same user instead of creating another", () => {
    notifications.subscribeToNotifications("user-1", vi.fn());
    notifications.subscribeToNotifications("user-1", vi.fn());
    expect(channel).toHaveBeenCalledTimes(1);
  });

  it("creates a separate channel per distinct user", () => {
    notifications.subscribeToNotifications("user-1", vi.fn());
    notifications.subscribeToNotifications("user-2", vi.fn());
    expect(channel).toHaveBeenCalledTimes(2);
  });

  it("fans a single INSERT event out to every listener on that user", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    notifications.subscribeToNotifications("user-1", listener1);
    notifications.subscribeToNotifications("user-1", listener2);

    const onInsertHandler = on.mock.calls[0][2];
    const payload = { new: { id: "notif-1" } };
    onInsertHandler(payload);

    expect(listener1).toHaveBeenCalledWith({ id: "notif-1" });
    expect(listener2).toHaveBeenCalledWith({ id: "notif-1" });
  });

  it("does not remove the channel while other listeners remain subscribed", () => {
    const unsub1 = notifications.subscribeToNotifications("user-1", vi.fn());
    notifications.subscribeToNotifications("user-1", vi.fn());
    unsub1();
    expect(removeChannel).not.toHaveBeenCalled();
  });

  it("removes the channel once the last listener unsubscribes", () => {
    const unsub1 = notifications.subscribeToNotifications("user-1", vi.fn());
    const unsub2 = notifications.subscribeToNotifications("user-1", vi.fn());
    unsub1();
    unsub2();
    expect(removeChannel).toHaveBeenCalledWith("the-channel-handle");
  });

  it("creating a channel again after full teardown works (not stuck on a stale entry)", () => {
    const unsub1 = notifications.subscribeToNotifications("user-1", vi.fn());
    unsub1();
    notifications.subscribeToNotifications("user-1", vi.fn());
    expect(channel).toHaveBeenCalledTimes(2);
  });
});

describe("markNotificationRead / markAllNotificationsRead", () => {
  it("calls the mark_notification_read RPC with the given id", async () => {
    rpc.mockResolvedValue({ error: null });
    await notifications.markNotificationRead("notif-1");
    expect(rpc).toHaveBeenCalledWith("mark_notification_read", { notification_id: "notif-1" });
  });

  it("throws when the RPC errors", async () => {
    rpc.mockResolvedValue({ error: { message: "boom" } });
    await expect(notifications.markNotificationRead("notif-1")).rejects.toBeTruthy();
  });

  it("markAllNotificationsRead calls its own RPC with no args", async () => {
    rpc.mockResolvedValue({ error: null });
    await notifications.markAllNotificationsRead();
    expect(rpc).toHaveBeenCalledWith("mark_all_notifications_read");
  });
});
