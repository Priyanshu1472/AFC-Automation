import { supabase } from "./supabase";

// Powers the "Active leads / Active proposals" hint next to each candidate
// in a Person Responsible picker (LeadForm.jsx's own PR field for creators
// who name it themselves, and LeadDetailPage.jsx's po_assign panel for a
// Project Officer assigning it on someone else's behalf). Calls the
// person_active_lead_and_proposal_counts RPC (SECURITY DEFINER — a plain
// client query would silently undercount, since can_view_lead()'s org-wide
// role list doesn't include project_officer, so RLS only ever exposes a
// fraction of a candidate's leads/proposals to that session) rather than
// counting client-side.
export async function withActiveCounts(users) {
  if (!users || users.length === 0) return users || [];
  const { data } = await supabase.rpc("person_active_lead_and_proposal_counts", { p_user_ids: users.map((u) => u.id) });
  const countsById = new Map((data || []).map((r) => [r.user_id, r]));
  return users.map((u) => ({
    ...u,
    active_leads: countsById.get(u.id)?.active_leads ?? 0,
    active_proposals: countsById.get(u.id)?.active_proposals ?? 0,
  }));
}

// {value, label, hint} for Select — label stays the plain name (used for
// the closed trigger and the searchable input's text); hint is JSX shown
// only in the dropdown list, stacked under the name in a smaller, muted
// font (see Select.jsx's option.hint handling).
export function personOption(u) {
  return {
    value: u.id,
    label: u.full_name,
    hint: (
      <>
        <span>Active leads: {u.active_leads ?? 0}</span>
        <span>Active proposals: {u.active_proposals ?? 0}</span>
      </>
    ),
  };
}
