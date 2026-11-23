-- Every internal (non-Business Partner) user should be able to VIEW any
-- proposal, org-wide, once its lead has reached md_approved (the only
-- status a proposal ever exists at) — actions (locking, fee note sign-off,
-- recording the client's outcome, etc.) stay exactly as gated today,
-- restricted to the lead's own Person Responsible/Reviewer/Recommending
-- Authority or md/admin. Business Partners are an outside identity (not
-- "the organisation") and keep their existing assigned-lead-only rule.
--
-- can_view_proposal()/can_view_lead_chat()/proposal/fee-note/document/EMD
-- table policies all go through can_view_lead() already, so one new clause
-- here is all that's needed for every direct-RLS read.
create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm', 'general_manager')
        or exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT')
        or (auth.uid() = l.created_by and public.is_current_user_team(l.team))
        or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id, l.handled_by_dgm_id)
        or (
          public.current_afc_role() in ('project_officer', 'area_manager', 'regional_manager', 'associate_consultant', 'project_assistant')
          and public.is_current_user_team(l.team)
        )
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
        or exists (
          select 1
          from public.lead_g3_escalation_members m
          join public.lead_g3_escalation_assignees a on a.escalation_id = m.escalation_id
          where m.lead_id = l.id and a.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.proposal_preparations pp
          join public.proposal_additional_responsibles par on par.proposal_id = pp.id
          where pp.lead_id = l.id and par.user_id = auth.uid()
        )
        or (l.status = 'md_approved' and public.current_afc_role() <> 'business_associate')
      )
  );
$$;
