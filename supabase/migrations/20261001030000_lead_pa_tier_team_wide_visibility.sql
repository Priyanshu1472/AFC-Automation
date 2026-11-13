-- can_view_lead() only ever gave a PA-tier role (project_officer,
-- area_manager, regional_manager, associate_consultant, project_assistant)
-- team-wide visibility while a lead had no Person Responsible yet
-- (person_responsible_id is null) — the "it just landed on your team,
-- someone needs to claim it" window. The moment a PO (or AM/RM) actually
-- did that — assigning PR/Reviewer/Recommending Authority via "po_assign"
-- — person_responsible_id stopped being null, that clause switched off,
-- and unless the PO happened to name themselves into one of those three
-- roles, they lost all access to a lead on their own team, including the
-- one they'd just processed. Same DGM/AGM/PMT already get full org-wide
-- visibility regardless of status — this brings the PA tier up to the
-- same "always see your own team's leads" bar, just scoped to their team
-- instead of org-wide.
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
      )
  );
$$;
