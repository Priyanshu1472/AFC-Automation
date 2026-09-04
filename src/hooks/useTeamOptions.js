import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { TEAMS } from "../lib/roles";

// TEAMS in lib/roles.js is just the original seed pair (BPDD, BIID) — team
// is a free-text column (no CHECK constraint), so any team typed into a
// creatable Select (see CreateUserPage/EditUserPage) becomes real the
// moment a user is saved with it. This hook merges that static seed list
// with whatever team names actually exist on afc_users, so newly-created
// teams show up as options for everyone from then on, not just in the
// browser tab that created them — and re-fetches on any afc_users change
// (not just on mount) so a team created in one tab shows up without a
// reload in every other tab/component using this hook right now.
export function useTeamOptions() {
  const [teams, setTeams] = useState(TEAMS);

  const fetchTeams = useCallback(async () => {
    const { data, error } = await supabase.from("afc_users").select("team").not("team", "is", null);
    if (error || !data) return;
    const fromDb = data.map((r) => r.team).filter(Boolean);
    setTeams([...new Set([...TEAMS, ...fromDb])].sort((a, b) => a.localeCompare(b)));
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  useEffect(() => {
    const channel = supabase
      .channel("team-options")
      .on("postgres_changes", { event: "*", schema: "public", table: "afc_users" }, () => fetchTeams())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchTeams]);

  return teams;
}
