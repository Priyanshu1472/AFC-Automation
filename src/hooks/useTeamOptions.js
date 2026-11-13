import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { TEAMS } from "../lib/roles";

// TEAMS in lib/roles.js is just the original seed pair (BPDD, BIID) — team
// is a free-text value (no CHECK constraint), so any team typed into a
// creatable Select (see CreateUserPage/EditUserPage) becomes real the
// moment a user is saved with it. This hook merges that static seed list
// with whatever team names actually exist, so newly-created teams show up
// as options for everyone from then on, not just in the browser tab that
// created them — and re-fetches on any relevant change (not just on mount)
// so a team created in one tab shows up without a reload in every other
// tab/component using this hook right now.
//
// A newly-created user's FIRST selected team is written to afc_users.team
// (the scalar "primary team"), but every team they're assigned — including
// a brand-new one picked as a second/third team, not the first — only ever
// lands in afc_user_teams (the multi-team membership table). Reading just
// afc_users.team would silently miss any team that never happened to be
// picked first for anyone yet, so both are queried and merged here.
export function useTeamOptions() {
  const [teams, setTeams] = useState(TEAMS);
  // supabase.channel(topic) dedupes by topic string, returning the SAME
  // channel object to a second caller instead of a new one — two
  // components calling this hook on the same page at once (e.g. the
  // Cross-Team Query panel and an MD transfer dialog, both open together)
  // would otherwise share one channel, and the second .on() call on an
  // already-subscribed channel throws ("cannot add postgres_changes
  // callbacks ... after subscribe()"). A per-instance topic sidesteps the
  // dedup entirely.
  const topicRef = useRef(`team-options-${Math.random().toString(36).slice(2)}`);

  const fetchTeams = useCallback(async () => {
    const [{ data: userRows, error: userErr }, { data: teamRows, error: teamErr }] = await Promise.all([
      supabase.from("afc_users").select("team").not("team", "is", null),
      supabase.from("afc_user_teams").select("team"),
    ]);
    if (userErr || teamErr || !userRows || !teamRows) return;
    const fromDb = [...userRows, ...teamRows].map((r) => r.team).filter(Boolean);
    setTeams([...new Set([...TEAMS, ...fromDb])].sort((a, b) => a.localeCompare(b)));
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  useEffect(() => {
    const channel = supabase
      .channel(topicRef.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "afc_users" }, () => fetchTeams())
      .on("postgres_changes", { event: "*", schema: "public", table: "afc_user_teams" }, () => fetchTeams())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchTeams]);

  return teams;
}
