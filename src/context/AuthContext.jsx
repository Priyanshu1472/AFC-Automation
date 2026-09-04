import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export const AuthContext = createContext(null);

const ACTIVE_TEAM_STORAGE_PREFIX = "afc_active_team_";

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("afc_users")
    .select("id, full_name, email, role, team, office, committee, is_active, must_change_password, pin_updated_at, signature_path")
    .eq("id", userId)
    .maybeSingle();

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

  return { ...data, teams };
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
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setActiveTeamState(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mountedRef.current) return;
      setUser(session?.user ?? null);
      await loadProfile(session?.user ?? null);
      if (mountedRef.current) setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mountedRef.current) return;
      setUser(session?.user ?? null);
      await loadProfile(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{ user, profile, activeTeam, setActiveTeam, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
