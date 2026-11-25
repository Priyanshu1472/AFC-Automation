import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dn;
let shown;

class FakeNotification {
  static permission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  constructor(title, options) {
    this.title = title;
    this.options = options;
    this.close = vi.fn();
    shown.push(this);
  }
}

const USER = "user-1";
const row = (over = {}) => ({
  id: "n1",
  user_id: USER,
  title: "Lead awaiting PMT review",
  sub_text: "Something happened",
  link: "/leads/abc",
  is_read: false,
  created_at: new Date().toISOString(),
  ...over,
});

function setActive(active) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(active ? "visible" : "hidden");
  vi.spyOn(document, "hasFocus").mockReturnValue(active);
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  shown = [];
  FakeNotification.permission = "granted";
  window.Notification = FakeNotification;
  setActive(false);
  dn = await import("./desktopNotifications");
  dn.setDesktopPreference(USER, true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.Notification;
});

async function deliver(r, userId = USER) {
  const p = dn.handleRealtimeNotification(userId, r);
  await vi.advanceTimersByTimeAsync(1000);
  await p;
}

describe("desktop notifications", () => {
  it("pops a new unread notification while PMIS is in the background", async () => {
    await deliver(row());
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("Lead awaiting PMT review");
    expect(shown[0].options.tag).toBe("pmis-notification-n1");
    expect(shown[0].options.icon).toBe(dn.DESKTOP_ICON);
    // Android paints the badge as a white mask — never the full-colour logo.
    expect(shown[0].options.badge).toBe("/icons/notification-badge-96.png");
  });

  it("never pops the same event twice (re-delivery, second subscription, remount)", async () => {
    const r = row();
    await deliver(r);
    await deliver({ ...r });
    expect(shown).toHaveLength(1);
  });

  it("skips an event another tab already claimed", async () => {
    const r = row();
    localStorage.setItem("pmis-desktop-notifications-seen", JSON.stringify([dn.eventKey(r)]));
    await deliver(r);
    expect(shown).toHaveLength(0);
  });

  it("pops again when a grouped chat notification is bumped with a fresh created_at", async () => {
    const t0 = Date.now();
    await deliver(row({ created_at: new Date(t0 - 5000).toISOString() }));
    await deliver(row({ created_at: new Date(t0).toISOString(), sub_text: "You have 2 unread messages" }));
    expect(shown).toHaveLength(2);
  });

  it("ignores read rows and old rows (mark-read updates, edits to old notifications)", async () => {
    await deliver(row({ is_read: true }));
    await deliver(row({ id: "n2", created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
    expect(shown).toHaveLength(0);
  });

  it("ignores a row belonging to a different user", async () => {
    await deliver(row({ user_id: "someone-else" }));
    expect(shown).toHaveLength(0);
  });

  it("respects the user preference separately from browser permission", async () => {
    dn.setDesktopPreference(USER, false);
    await deliver(row());
    expect(shown).toHaveLength(0);
  });

  it("does nothing without browser permission", async () => {
    FakeNotification.permission = "denied";
    await deliver(row());
    expect(shown).toHaveLength(0);
  });

  it("pops up even while the person is looking at PMIS", async () => {
    setActive(true);
    await deliver(row());
    expect(shown).toHaveLength(1);
  });

  it("is on by default once the browser allows it — for every account on this browser", async () => {
    localStorage.clear();
    await deliver(row({ user_id: "user-2" }), "user-2");
    expect(dn.getDesktopPreference("user-2")).toBe(true);
    expect(shown).toHaveLength(1);
  });

  it("click focuses PMIS, marks it read and navigates to its link", async () => {
    const navigate = vi.fn();
    const markNotificationRead = vi.fn(() => Promise.resolve());
    dn.setDesktopNotificationHandlers({ navigate, markNotificationRead });
    await deliver(row());
    shown[0].onclick({ preventDefault() {} });
    expect(markNotificationRead).toHaveBeenCalledWith("n1");
    expect(navigate).toHaveBeenCalledWith("/leads/abc");
  });

  it("offers the first-visit prompt only once, and only before the browser was asked", () => {
    localStorage.clear();
    FakeNotification.permission = "default";
    expect(dn.shouldOfferDesktopPrompt(USER)).toBe(true);
    dn.dismissDesktopPrompt(USER);
    expect(dn.shouldOfferDesktopPrompt(USER)).toBe(false);
  });

  it("enabling asks the browser, and an explicit Turn off survives it being granted", async () => {
    localStorage.clear();
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockResolvedValueOnce("denied");
    expect(await dn.enableDesktopNotifications(USER)).toBe("denied");
    dn.setDesktopPreference(USER, false);
    expect(dn.getDesktopPreference(USER)).toBe(false);
    FakeNotification.requestPermission.mockResolvedValueOnce("granted");
    expect(await dn.enableDesktopNotifications(USER)).toBe("granted");
    expect(dn.getDesktopPreference(USER)).toBe(true);
  });
});
