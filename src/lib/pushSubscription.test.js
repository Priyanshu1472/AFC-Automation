import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: (...a) => invoke(...a) } } }));

let push;
let sub;
let pushManager;

function installBrowser({ permission = "granted" } = {}) {
  sub = { endpoint: "https://fcm.googleapis.com/fcm/send/old", options: {}, toJSON: () => ({ endpoint: sub.endpoint }), unsubscribe: vi.fn(async () => true) };
  pushManager = {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/new", options: {}, toJSON: () => ({ endpoint: "new" }) })),
  };
  const reg = { pushManager };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => reg, ready: Promise.resolve(reg), addEventListener() {} },
  });
  window.PushManager = function PushManager() {};
  window.Notification = { permission, requestPermission: async () => permission };
}

beforeEach(async () => {
  vi.resetModules();
  invoke.mockReset();
  localStorage.clear();
  installBrowser();
  push = await import("./pushSubscription");
});

describe("push registration status", () => {
  it("reports registered once the server saved this device", async () => {
    invoke.mockResolvedValueOnce({ data: { public_key: "AAAA" }, error: null }).mockResolvedValueOnce({ data: { success: true }, error: null });
    expect(await push.syncPushSubscription("u-1")).toBe(true);
    expect(push.getPushStatus().state).toBe("registered");
  });

  it("surfaces a failure instead of swallowing it", async () => {
    invoke.mockResolvedValueOnce({ data: { public_key: "AAAA" }, error: null });
    pushManager.getSubscription.mockResolvedValueOnce(null);
    pushManager.subscribe.mockRejectedValueOnce(new Error("Registration failed - push service error"));
    expect(await push.syncPushSubscription("u-1")).toBe(false);
    expect(push.getPushStatus()).toEqual({ state: "error", error: "Registration failed - push service error" });
  });

  it("fresh: drops the lingering subscription and registers a new one", async () => {
    invoke.mockResolvedValue({ data: { public_key: "AAAA", success: true }, error: null });
    await push.syncPushSubscription("u-1", { fresh: true });
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("push-subscription", { body: { action: "unsubscribe", endpoint: "https://fcm.googleapis.com/fcm/send/old" } });
    expect(pushManager.subscribe).toHaveBeenCalled();
    expect(push.getPushStatus().state).toBe("registered");
  });

  it("is off (and unregistered) when the person turned desktop notifications off", async () => {
    localStorage.setItem("pmis-desktop-notifications:u-1", "off");
    invoke.mockResolvedValue({ data: {}, error: null });
    await push.syncPushSubscription("u-1");
    expect(push.getPushStatus().state).toBe("off");
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});
