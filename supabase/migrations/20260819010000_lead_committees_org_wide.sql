-- Committees are NOT team-specific — PMT, PMT Extended, and G3 each work
-- across all 4 teams, not one team apiece. Per explicit product decision:
--   1. All three committees get org-wide lead visibility (not just G3, and
--      not gated to dgm_review status).
--   2. Admin can view every lead (unchanged) but cannot create one.

-- Committee members act org-wide now, so their name needs to be visible to
-- whoever is looking at a lead they touched (timeline/detail), even across
-- teams — widen the narrow afc_users visibility policy (20260819000000)
-- the same way can_view_lead is widened below.
drop policy if exists afc_users_select_own_team_active on public.afc_users;
create policy afc_users_select_own_team_active on public.afc_users
for select using (
  is_active = true
  and (team = public.current_afc_team() or committee in ('PMT', 'PMT Extended', 'G3'))
);

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
        public.current_afc_role() in ('md', 'admin')
        or exists (
          select 1 from public.afc_users u
          where u.id = auth.uid()
            and (u.team = l.team or u.committee in ('PMT', 'PMT Extended', 'G3'))
        )
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.approval_authority_id, l.handled_by_dgm_id)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
