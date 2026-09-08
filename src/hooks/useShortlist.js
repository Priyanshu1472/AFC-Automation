import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export function useShortlist() {
  const { profile, activeTeam } = useAuth();
  const [shortlists, setShortlists] = useState([]);
  const [membership, setMembership] = useState({});
  const [loading, setLoading] = useState(true);

  const refreshShortlists = useCallback(async () => {
    setLoading(true);
    try {
      const { data: lists } = await supabase
        .from("shortlists")
        .select(`
          id, name, created_by, team, created_at,
          creator:afc_users!created_by ( full_name ),
          shortlist_projects (
            id, project_id, selected_kw_names,
            projects ( id, title, client, location )
          )
        `)
        .order("created_at", { ascending: false });

      setShortlists((lists || []).map((sl) => ({ ...sl, creator_name: sl.creator?.full_name || null })));

      const map = {};
      (lists || []).forEach((sl) => {
        (sl.shortlist_projects || []).forEach((sp) => {
          if (!map[sp.project_id]) map[sp.project_id] = [];
          map[sp.project_id].push(sl.id);
        });
      });
      setMembership(map);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshShortlists();
  }, [refreshShortlists]);

  const createShortlist = useCallback(
    async (name) => {
      const { data, error } = await supabase
        .from("shortlists")
        .insert({
          name: name.trim(),
          created_by: profile?.id ?? null,
          team: activeTeam ?? profile?.team ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      await refreshShortlists();
      return data;
    },
    [profile, activeTeam, refreshShortlists]
  );

  const addToShortlist = useCallback(
    async (projectId, selectedKwNames = [], shortlistId) => {
      const { error } = await supabase
        .from("shortlist_projects")
        .upsert(
          { shortlist_id: shortlistId, project_id: projectId, selected_kw_names: selectedKwNames },
          { onConflict: "shortlist_id,project_id" }
        );
      if (error) throw error;
      await refreshShortlists();
    },
    [refreshShortlists]
  );

  const removeProject = useCallback(
    async (shortlistId, projectId) => {
      await supabase.from("shortlist_projects").delete().eq("shortlist_id", shortlistId).eq("project_id", projectId);
      await refreshShortlists();
    },
    [refreshShortlists]
  );

  const deleteShortlist = useCallback(
    async (shortlistId) => {
      await supabase.from("shortlists").delete().eq("id", shortlistId);
      await refreshShortlists();
    },
    [refreshShortlists]
  );

  const isInAnyShortlist = useCallback((projectId) => !!membership[projectId]?.length, [membership]);
  const getProjectShortlists = useCallback((projectId) => membership[projectId] || [], [membership]);

  return {
    shortlists,
    loading,
    createShortlist,
    addToShortlist,
    removeProject,
    deleteShortlist,
    isInAnyShortlist,
    getProjectShortlists,
    refreshShortlists,
  };
}
