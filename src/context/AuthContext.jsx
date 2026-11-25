import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { removePushSubscription } from "../lib/pushSubscription";
import { markRecoveryInProgress, clearRecoveryFlag, isRecoveryInProgress } from "../lib/passwordRecoveryFlag";

export { clearRecoveryFlag };

export const AuthContext = createContext(null);

const ACTIVE_TEAM_STORAGE_PREFIX = "afc_active_team_";

// Clicking a "reset your password" emailed link hands the tab that opens
// it a genuine, valid Supabase session (type=recovery) — and since
// supabase-js mirrors the session into localStorage, every OTHER already-
// open tab of this app picks it up too, via the SDK's own cross-tab sync,
// and (without this) would quietly show the user as logged in before
// they've actually set anything. lib/supabase.js already set the
// recovery flag synchronously from the URL, before the Supabase client
// (and any of its cross-tab broadcasting) even existed — the
// PASSWORD_RECOVERY branch below is a second, redundant trigger for it
// (harmless either way; belt-and-suspenders in case the URL marker was
// ever missed). Every tab's onAuthStateChange ignores whatever session is
// present while the flag is active; useSetNewPassword clears it right on
// a successful submit. It auto-expires rather than being a plain boolean,
// so an abandoned reset (tab closed without submitting) can't wedge every
// tab logged-out forever. An explicit, deliberate login (useLogin's
// handleLogin) is unaffected either way — it calls refreshProfile()
// directly, which this flag never gates, only the passive
// getSession()/onAuthStateChange path.

const PROFILE_COLUMNS = "id, full_name, email, role, team, office, committee, is_active, must_change_password, pin_updated_at, signature_path, avatar_path";

async function fetchProfile(userId) {
  const { data, error } = await supabase.from("afc_users").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();

  if (error) throw error;
  if (!data) return data;

  // Full assigned-team set (primary team first) — afc_users.team stays the
  // scalar "primary team" for backward compat; afc_user_teams is the
  // authoritative membership set the multi-team switcher reads from. Falls
  // back to just the primary team if the join comes back empty (e.g. a row
  // whose afc_user_teams backfill hasn't run — shouldn't happen post-migration,
  // but a single-team fallback here is harmless either way).
  const { data: teamRows } = await supabase.from("afc_user_teams").select("team").eq("user_id", userId);
  const teamSet = (teamRows || []).map((r) => r.team);
  const teams = teamSet.length
    ? [data.team, ...teamSet.filter((t) => t !== data.team)].filter(Boolean)
    : data.team
      ? [data.team]
      : [];

  // Same pattern for committees — a person can now hold more than one
  // (e.g. PMT and Accounts). Every `profile.committee === "X"` check in the
  // app should move to `profile.committees?.includes("X")` so a secondary
  // committee isn't silently invisible.
  const { data: committeeRows } = await supabase.from("afc_user_committees").select("committee").eq("user_id", userId);
  const committeeSet = (committeeRows || []).map((r) => r.committee);
  const committees = committeeSet.length
    ? [data.committee, ...committeeSet.filter((c) => c !== data.committee)].filter(Boolean)
    : data.committee
      ? [data.committee]
      : [];

  // Super Admin has every Admin power (plus Module Settings): `role` is the
  // effective role every `profile.role === "admin"` / roles-list check reads,
  // `actualRole` keeps the stored one (label, Module Settings). Same mapping
  // as the DB's current_afc_role() and the edge functions' getCallerProfile.
  const actualRole = data.role;
  const role = actualRole === "super_admin" ? "admin" : actualRole;

  return { ...data, role, actualRole, teams, committees };
}

function loadStoredActiveTeam(userId, teams) {
  if (!userId || !teams?.length) return null;
  try {
    const stored = localStorage.getItem(ACTIVE_TEAM_STORAGE_PREFIX + userId);
    if (stored && teams.includes(stored)) return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to default.
  }
  return teams[0];
}

// Single source of truth for "who is logged in" — the live Supabase session
// plus the afc_users profile row derived from it. There is no parallel
// session store; whatever the Supabase SDK currently holds is authoritative.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeTeam, setActiveTeamState] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const profileIdRef = useRef(null);
  profileIdRef.current = profile?.id ?? null;

  const setActiveTeam = useCallback((team) => {
    setActiveTeamState(team);
    if (profileIdRef.current) {
      try {
        localStorage.setItem(ACTIVE_TEAM_STORAGE_PREFIX + profileIdRef.current, team);
      } catch {
        // localStorage unavailable — the switch still works for this session.
      }
    }
  }, []);

  const loadProfile = useCallback(async (sessionUser) => {
    if (!sessionUser) {
      setProfile(null);
      setActiveTeamState(null);
      return;
    }
    try {
      const row = await fetchProfile(sessionUser.id);
      if (mountedRef.current) {
        setProfile(row);
        setActiveTeamState(row ? loadStoredActiveTeam(row.id, row.teams) : null);
      }
    } catch {
      if (mountedRef.current) {
        setProfile(null);
        setActiveTeamState(null);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await loadProfile(session?.user ?? null);
    return session?.user ?? null;
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    // While still signed in: stop Web Push sending this user's
    // notifications to this browser.
    await removePushSubscription();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setActiveTeamState(null);
    try {
      // Per-page list filters (LeadListPage, UserListPage, etc.) persist in
      // sessionStorage so a trip out to a detail page and back restores
      // where you left off — but that same persistence would otherwise
      // survive a sign-out, so the next person to log in in this tab (or
      // this user logging back in) would land mid-filter instead of on a
      // clean, unfiltered list. Sign-out is the one point that should
      // reset all of it.
      sessionStorage.clear();
    } catch {
      // Private browsing / storage disabled — nothing to clear.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mountedRef.current) return;
      if (isRecoveryInProgress()) {
        setUser(null);
        await loadProfile(null);
        setLoading(false);
        return;
      }
      setUser(session?.user ?? null);
      await loadProfile(session?.user ?? null);
      if (mountedRef.current) setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mountedRef.current) return;
      if (event === "PASSWORD_RECOVERY") markRecoveryInProgress();
      if (isRecoveryInProgress()) {
        setUser(null);
        await loadProfile(null);
        setLoading(false);
        return;
      }
      setUser(session?.user ?? null);
      await loadProfile(session?.user ?? null);
      setLoading(false);
    });

    // Backgrounded/inactive tabs get their JS timers throttled or fully
    // suspended by the browser, so the SDK's own scheduled silent-refresh
    // (due before the 1-hour access token expires) can simply never fire
    // while the tab is hidden — the session then looks expired the moment
    // you come back, even though autoRefreshToken is on and would have
    // renewed it fine had the tab stayed foregrounded. Explicitly
    // re-checking (and, if needed, refreshing) on visibilitychange is the
    // standard workaround: getSession() returns the cached session
    // instantly if it's still fresh, or transparently refreshes it first
    // if it's stale — either way this fires onAuthStateChange with the
    // correct up-to-date session instead of leaving a stale one in place
    // until some unrelated API call happens to 401.
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        supabase.auth.getSession();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{ user, profile, activeTeam, setActiveTeam, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
