import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export const AuthContext = createContext(null);

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("afc_users")
    .select("id, full_name, email, role, team, office, committee, is_active, must_change_password")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Single source of truth for "who is logged in" — the live Supabase session
// plus the afc_users profile row derived from it. There is no parallel
// session store; whatever the Supabase SDK currently holds is authoritative.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const loadProfile = useCallback(async (sessionUser) => {
    if (!sessionUser) {
      setProfile(null);
      return;
    }
    try {
      const row = await fetchProfile(sessionUser.id);
      if (mountedRef.current) setProfile(row);
    } catch {
      if (mountedRef.current) setProfile(null);
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
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
