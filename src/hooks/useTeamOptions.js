import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { TEAMS } from "../lib/roles";

// TEAMS in lib/roles.js is just the original seed pair (BPDD, BIID) — team
// is a free-text column (no CHECK constraint), so any team typed into a
// creatable Select (see CreateUserPage/EditUserPage) becomes real the
// moment a user is saved with it. This hook merges that static seed list
// with whatever team names actually exist on afc_users, so newly-created
// teams show up as options for everyone from then on, not just in the
// browser tab that created them.
export function useTeamOptions() {
  const [teams, setTeams] = useState(TEAMS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("afc_users").select("team").not("team", "is", null);
      if (cancelled || error || !data) return;
      const fromDb = data.map((r) => r.team).filter(Boolean);
      const merged = [...new Set([...TEAMS, ...fromDb])].sort((a, b) => a.localeCompare(b));
      setTeams(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return teams;
}
