import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { markNotificationRead } from "../../lib/notifications";
import {
  dismissDesktopPrompt,
  enableDesktopNotifications,
  getDesktopPermission,
  getDesktopPreference,
  setDesktopNotificationHandlers,
  setDesktopPreference,
  shouldOfferDesktopPrompt,
  subscribeDesktopState,
} from "../../lib/desktopNotifications";
import { getPushStatus, subscribePushStatus, syncPushSubscription } from "../../lib/pushSubscription";
import { BellIcon, CloseIcon } from "../icons";
import "../../styles/DesktopNotifications.css";

const BLOCKED_HELP =
  "Your browser is blocking PMIS notifications. Click the icon left of the address bar → Site settings → Notifications → Allow, then reload PMIS.";

function readState(userId) {
  return {
    permission: getDesktopPermission(),
    preference: getDesktopPreference(userId),
    offerPrompt: shouldOfferDesktopPrompt(userId),
  };
}

function useDesktopState(userId) {
  const [state, setState] = useState(() => readState(userId));
  useEffect(() => {
    const refresh = () => setState(readState(userId));
    refresh();
    const unsub = subscribeDesktopState(refresh);
    // Permission can change in browser settings without an event in some
    // browsers — re-check when the tab regains focus.
    window.addEventListener("focus", refresh);
    return () => {
      unsub();
      window.removeEventListener("focus", refresh);
    };
  }, [userId]);
  return state;
}

function usePushStatus() {
  const [status, setStatus] = useState(getPushStatus);
  useEffect(() => subscribePushStatus(setStatus), []);
  return status;
}

// One on/off action for both controls: turning on asks the browser for
// permission the first time; turning off is just the PMIS preference.
// Turning on always registers this device afresh for Web Push.
async function toggleDesktop(userId, permission, isOn) {
  if (isOn) {
    setDesktopPreference(userId, false);
    return;
  }
  if (permission === "granted") setDesktopPreference(userId, true);
  else await enableDesktopNotifications(userId);
  await syncPushSubscription(userId, { fresh: true });
}

// Whether this device will also get notifications with PMIS closed — and
// if not, why, with a way to retry.
function PushDeviceStatus({ userId }) {
  const push = usePushStatus();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    await syncPushSubscription(userId, { fresh: true });
    setBusy(false);
  }

  if (push.state === "registered") {
    return <p className="desktop-notif-help desktop-notif-device-ok">This device is set up: notifications arrive even when PMIS is closed.</p>;
  }
  if (push.state === "checking" || push.state === "off") {
    return <p className="desktop-notif-help">Setting up this device…</p>;
  }
  return (
    <p className="desktop-notif-help desktop-notif-device-error">
      This device isn't receiving notifications while PMIS is closed: {push.error}{" "}
      <button type="button" className="desktop-notif-link" onClick={retry} disabled={busy}>
        {busy ? "Retrying…" : "Retry"}
      </button>
    </p>
  );
}

// Toggle switch in the profile menu.
export function DesktopNotificationToggle() {
  const { profile } = useAuth();
  const userId = profile?.id;
  const { permission, preference } = useDesktopState(userId);
  const [busy, setBusy] = useState(false);

  if (!userId) return null;

  const isOn = permission === "granted" && preference;
  const blocked = permission === "denied";
  const unsupported = permission === "unsupported";

  async function handleToggle() {
    if (busy || blocked || unsupported) return;
    setBusy(true);
    await toggleDesktop(userId, permission, isOn);
    setBusy(false);
  }

  return (
    <div className="desktop-notif-menu">
      <button
        type="button"
        className="user-menu-item desktop-notif-menu-item"
        role="menuitemcheckbox"
        aria-checked={isOn}
        onClick={handleToggle}
        disabled={busy || blocked || unsupported}
      >
        <span>Desktop Notifications</span>
        <span className={`desktop-notif-switch${isOn ? " on" : ""}`} aria-hidden="true">
          <span className="desktop-notif-switch-knob" />
        </span>
      </button>
      {isOn && (
        <div className="desktop-notif-menu-device">
          <PushDeviceStatus userId={userId} />
        </div>
      )}
      {blocked && <p className="desktop-notif-menu-help">{BLOCKED_HELP}</p>}
      {unsupported && <p className="desktop-notif-menu-help">Not supported in this browser. Use Chrome or Edge.</p>}
    </div>
  );
}

// Status + on/off control, shown at the foot of the Notifications panel.
export function DesktopNotificationSettings() {
  const { profile } = useAuth();
  const userId = profile?.id;
  const { permission, preference } = useDesktopState(userId);
  const [busy, setBusy] = useState(false);

  if (!userId) return null;

  async function toggle(isOn) {
    setBusy(true);
    await toggleDesktop(userId, permission, isOn);
    setBusy(false);
  }

  let status;
  let tone;
  let action = null;
  let help = null;

  if (permission === "unsupported") {
    status = "Not supported";
    tone = "muted";
    help = "This browser can't show desktop notifications. Use Google Chrome or Microsoft Edge.";
  } else if (permission === "denied") {
    status = "Blocked";
    tone = "danger";
    help = BLOCKED_HELP;
  } else if (permission === "granted" && preference) {
    status = "Enabled";
    tone = "success";
    action = (
      <button type="button" className="desktop-notif-link" onClick={() => toggle(true)} disabled={busy}>
        Turn off
      </button>
    );
  } else {
    status = permission === "granted" ? "Turned off" : "Not yet enabled";
    tone = "muted";
    action = (
      <button type="button" className="desktop-notif-link" onClick={() => toggle(false)} disabled={busy}>
        {permission === "granted" ? "Turn on" : "Enable"}
      </button>
    );
  }

  return (
    <div className="desktop-notif-settings">
      <div className="desktop-notif-row">
        <span className="desktop-notif-label">Desktop notifications</span>
        <span className="desktop-notif-row-end">
          <span className={`desktop-notif-status desktop-notif-status-${tone}`}>{status}</span>
          {action}
        </span>
      </div>
      {help && <p className="desktop-notif-help">{help}</p>}
      {permission === "granted" && preference && <PushDeviceStatus userId={userId} />}
    </div>
  );
}

// Mounted once in the app shell: wires pop-up clicks to the router, keeps
// this browser's Web Push registration in step with the switches, and on a
// first visit offers (once) to turn desktop notifications on.
export function DesktopNotificationPrompt() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const userId = profile?.id;
  const { permission, preference, offerPrompt } = useDesktopState(userId);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDesktopNotificationHandlers({ navigate, markNotificationRead }), [navigate]);

  useEffect(() => {
    if (userId) syncPushSubscription(userId);
  }, [userId, permission, preference]);

  // PMIS opened from a pop-up while no tab was open (src/sw.js adds
  // ?pmis_notification=<id>): mark it read, as clicking it in-app does.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("pmis_notification");
    if (!id || !userId) return;
    markNotificationRead(Number(id)).catch(() => {});
    params.delete("pmis_notification");
    const search = params.toString();
    navigate(`${location.pathname}${search ? `?${search}` : ""}${location.hash}`, { replace: true });
  }, [location, userId, navigate]);

  if (!userId || !offerPrompt) return null;

  async function enable() {
    setBusy(true);
    await enableDesktopNotifications(userId);
    setBusy(false);
  }

  return (
    <div className="desktop-notif-prompt" role="dialog" aria-label="Enable desktop notifications">
      <span className="desktop-notif-prompt-icon" aria-hidden="true"><BellIcon /></span>
      <div className="desktop-notif-prompt-body">
        <span className="desktop-notif-prompt-title">Get desktop notifications</span>
        <span className="desktop-notif-prompt-text">
          See new PMIS alerts on your desktop, even when PMIS isn't open.
        </span>
        <span className="desktop-notif-prompt-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={enable} disabled={busy}>
            Enable
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismissDesktopPrompt(userId)}>
            Not now
          </button>
        </span>
      </div>
      <button
        type="button"
        className="desktop-notif-prompt-close"
        onClick={() => dismissDesktopPrompt(userId)}
        aria-label="Dismiss"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
