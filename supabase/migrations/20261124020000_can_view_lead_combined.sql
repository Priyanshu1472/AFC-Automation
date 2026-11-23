-- One definition of can_view_lead() for both environments.
--
-- Two migrations shared version 20261117010000 and each redefined
-- can_view_lead(): committee_checks_use_full_set (PMT via has_committee(),
-- i.e. any committee the user holds, not just the primary one) and
-- org_wide_internal_proposal_view (every internal user can view an
-- md_approved lead/proposal, but with the old primary-committee PMT check).
-- Staging ended up with the second, production with the first. This keeps
-- both rules.
create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm', 'general_manager')
        or public.has_committee('PMT')
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
