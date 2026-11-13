-- Powers the "Active leads: N · Active proposals: N" hint shown next to
-- each candidate's name in the Person Responsible picker — both on the
-- Lead Add/Edit form (LeadForm.jsx, for creators who name PR themselves)
-- and the Project Officer's po_assign panel (LeadDetailPage.jsx). A plain
-- client-side query can't do this: can_view_lead()'s org-wide role list
-- doesn't include project_officer, so a PO's own session only ever sees a
-- fraction of a candidate's leads/proposals via RLS (whichever ones the PO
-- also happens to be named on) — a silent undercount, not an error. This
-- SECURITY DEFINER RPC aggregates server-side instead, the same pattern as
-- get_team_business_associates/find_similar_leads, and only ever returns
-- two integers per requested user id — no row-level lead/proposal data.
--
-- "Active lead" mirrors leadStatus.js's TERMINAL_STATUSES exactly — a lead
-- not yet md_approved/md_declined/pa_dropped. "Active proposal" mirrors
-- ProposalsListPage.jsx's own definition: proposal_preparations has no
-- status column of its own — client_response is null until the client
-- accepts/rejects, regardless of the `locked` mid-review flag.
create or replace function public.person_active_lead_and_proposal_counts(p_user_ids uuid[])
returns table (user_id uuid, active_leads bigint, active_proposals bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    cand.id as user_id,
    (
      select count(*) from public.leads l
      where l.person_responsible_id = cand.id
        and l.status not in ('md_approved', 'md_declined', 'pa_dropped')
    ) as active_leads,
    (
      select count(*) from public.proposal_preparations pp
      join public.leads l2 on l2.id = pp.lead_id
      where l2.person_responsible_id = cand.id
        and pp.client_response is null
    ) as active_proposals
  from unnest(p_user_ids) as cand(id);
$$;

revoke all on function public.person_active_lead_and_proposal_counts(uuid[]) from public;
grant execute on function public.person_active_lead_and_proposal_counts(uuid[]) to authenticated;
