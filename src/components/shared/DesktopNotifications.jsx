import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { BellIcon, CloseIcon } from "../icons";
import "../../styles/DesktopNotifications.css";

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

// Status + on/off control, shown at the foot of the Notifications panel.
export function DesktopNotificationSettings() {
  const { profile } = useAuth();
  const userId = profile?.id;
  const { permission, preference } = useDesktopState(userId);
  const [busy, setBusy] = useState(false);

  if (!userId) return null;

  async function enable() {
    setBusy(true);
    await enableDesktopNotifications(userId);
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
    help = "Your browser is blocking PMIS notifications. Click the icon left of the address bar → Site settings → Notifications → Allow, then reload PMIS.";
  } else if (permission === "granted" && preference) {
    status = "Enabled";
    tone = "success";
    action = (
      <button type="button" className="desktop-notif-link" onClick={() => setDesktopPreference(userId, false)}>
        Turn off
      </button>
    );
  } else if (permission === "granted") {
    status = "Turned off";
    tone = "muted";
    action = (
      <button type="button" className="desktop-notif-link" onClick={() => setDesktopPreference(userId, true)}>
        Turn on
      </button>
    );
  } else {
    status = "Not yet enabled";
    tone = "muted";
    action = (
      <button type="button" className="desktop-notif-link" onClick={enable} disabled={busy}>
        Enable
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
    </div>
  );
}

// Mounted once in the app shell: wires pop-up clicks to the router, and on
// a first visit offers (once) to turn desktop notifications on.
export function DesktopNotificationPrompt() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const userId = profile?.id;
  const { offerPrompt } = useDesktopState(userId);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDesktopNotificationHandlers({ navigate, markNotificationRead }), [navigate]);

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
          See new PMIS alerts even while you're working in another tab or app.
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
