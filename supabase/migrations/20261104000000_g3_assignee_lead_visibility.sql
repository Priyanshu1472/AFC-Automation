-- G3 committee members are ordinary team roles (not necessarily dgm/agm/
-- srm/md/admin/cfo/cs, which already get org-wide can_view_lead), so the
-- G3 assignees PMT picks when escalating (see 20261103000000) could see
-- the escalation decision box and chat for every member lead, but not open
-- the conflicting leads' own detail pages at all — can_view_lead() had no
-- clause for them. Widened so a G3 assignee can view every lead in an
-- escalation they were actually picked for (primary + every conflict
-- lead), same as MD already could via its existing org-wide role clause.

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
      )
  );
$$;
