-- The creator's own always-visible clause in can_view_lead() didn't check
-- team membership, so once a lead transferred away to a different team
-- (see _shared/leadTransfer.ts), its original creator could still open it
-- forever — even though every field they'd have any business with
-- (person_responsible_id, reviewer_id, recommending_authority_id,
-- handled_by_dgm_id) was already cleared on transfer. Every other
-- always-visible column (PR/Reviewer/Recommending Authority/DGM) is
-- naturally covered already, since those get nulled on transfer — only
-- created_by persists across a transfer, so it's the only one that needed
-- the extra team check.
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
        or (l.person_responsible_id is null and public.is_current_user_team(l.team))
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
