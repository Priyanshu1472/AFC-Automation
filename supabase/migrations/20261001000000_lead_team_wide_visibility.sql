-- Fix: "Team Leads" was supposed to show every lead on a user's own
-- team(s) to every member of that team, but can_view_lead()'s team-match
-- clause only applied while person_responsible_id was still null (i.e.
-- an unassigned, still-po_assignment lead). The moment a Person
-- Responsible was named, any team member not personally named on the
-- lead (not creator/PR/reviewer/recommending authority) lost visibility
-- entirely — RLS never returned the row to them at all, regardless of
-- what the frontend's isTeamLead() would otherwise show. This mattered
-- most for plain team-scoped roles (Project Officer, Associate
-- Consultant, Project Assistant, Area Manager, Regional Manager), since
-- md/admin/cfo/cs/dgm/agm/srm/general_manager and PMT already had
-- unconditional org-wide visibility via the first clause.
--
-- Fix: drop the `person_responsible_id is null` restriction — team
-- membership alone is now enough to see every lead on that team,
-- assigned or not, matching "every user of a team sees all of that
-- team's leads" exactly as intended for the Team Leads tab.
create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm', 'general_manager')
        or exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT')
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.recommending_authority_id, l.handled_by_dgm_id)
        or public.is_current_user_team(l.team)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
