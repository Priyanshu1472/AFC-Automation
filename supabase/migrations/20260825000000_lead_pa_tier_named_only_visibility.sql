-- can_view_lead() — finish the visibility narrowing that
-- 20260822000000_lead_workflow_pin_and_visibility.sql's own header comment
-- already described but never actually implemented in the SQL: drop the
-- blanket "any project_assistant/project_officer/associate_consultant on
-- this team sees every team lead" clause. AGM/SRM never had this blanket
-- clause (already named-only); DGM keeps team-wide visibility (unchanged).
--
-- After this, project_assistant/project_officer/associate_consultant only
-- see a lead when they're actually named on it (creator/Person
-- Responsible/Reviewer/Approval Authority) or, while it sits at a stage
-- their committee reviews, via the PMT/PMT Extended/G3 clauses below.
--
-- Known consequence (already anticipated in the prior migration's comment,
-- not a new regression): a PA-tier user not named on a dropped lead no
-- longer sees it to use "Claim" — claiming now only works for someone
-- already named on the lead.

create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs')
        or (
          public.current_afc_role() = 'dgm'
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.team = l.team)
        )
        or (
          l.status in ('dgm_initial_review', 'dgm_review')
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'G3')
        )
        or (
          l.status = 'pmt_review'
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT')
        )
        or (
          l.status = 'pmt_extended_review'
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT Extended')
        )
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.approval_authority_id, l.handled_by_dgm_id)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
