// Shared by lib/supabase.js (which must set this FIRST, before the
// Supabase client even exists) and context/AuthContext.jsx (which reads/
// clears it). Kept out of both of those to avoid a module-load-order
// problem: supabase.js has to mark the flag before calling createClient(),
// so it can't import anything that itself imports the supabase client.
//
// Why this exists: clicking a "reset your password" emailed link hands
// the tab that opens it a genuine, valid Supabase session (type=recovery).
// supabase-js mirrors every session into localStorage and broadcasts it to
// every other open tab of this app via a BroadcastChannel/storage-event
// mechanism — and that broadcast can reach another tab before (or at
// about the same moment as) this tab's own PASSWORD_RECOVERY event fires,
// so reacting to that event alone races the broadcast and can lose. Instead,
// the very first thing this module does, at import time — before the
// Supabase client is constructed, before any async SDK work starts — is
// check the URL itself for the recovery marker and set this flag
// synchronously if it's there. That happens-before anything the SDK could
// tell another tab, so there's nothing left to race.
const RECOVERY_FLAG_KEY = "afc_password_recovery_until";
const RECOVERY_WINDOW_MS = 5 * 60 * 1000;

export function markRecoveryInProgress() {
  try {
    localStorage.setItem(RECOVERY_FLAG_KEY, String(Date.now() + RECOVERY_WINDOW_MS));
  } catch {
    // localStorage unavailable — the cross-tab leak just can't be
    // suppressed in this browsing mode; nothing else to fall back to.
  }
}

export function clearRecoveryFlag() {
  try {
    localStorage.removeItem(RECOVERY_FLAG_KEY);
  } catch {
    // Nothing to clear if storage isn't available in the first place.
  }
}

export function isRecoveryInProgress() {
  try {
    const until = Number(localStorage.getItem(RECOVERY_FLAG_KEY));
    if (!until) return false;
    if (Date.now() > until) {
      clearRecoveryFlag();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Supabase's recovery link can land either as a URL hash fragment
// (#access_token=...&type=recovery — the classic implicit flow) or as a
// query string (?code=...&type=recovery, under the PKCE flow) depending on
// project config, so both are checked. This must run synchronously at
// import time in lib/supabase.js, before createClient() — see module
// comment above.
export function markRecoveryInProgressIfUrlSaysSo() {
  if (typeof window === "undefined") return;
  if (/type=recovery/.test(window.location.hash) || /type=recovery/.test(window.location.search)) {
    markRecoveryInProgress();
  }
}
