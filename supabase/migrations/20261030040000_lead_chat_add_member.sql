-- PMT can add DGM-tier users (dgm/agm/srm/general_manager, any team) to a
-- lead's chat from the chat panel's "Add member" button
-- (add-lead-chat-member edge function). These roles can already view every
-- lead org-wide via can_view_lead(), so no lead-visibility change is needed
-- — only the chat roster, which 20261030000000_lead_chat_restrict_dgm_tier
-- made the sole gate for their chat access.
--
-- get_lead_chat_add_candidates() lists who can still be added — PMT only,
-- since afc_users' own RLS doesn't let a PMT member see other teams' users.

-- Undo the roster clause an earlier draft of this migration added to
-- can_view_lead() (it was applied live before the scope was narrowed to
-- DGM-tier only).
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

create or replace function public.get_lead_chat_add_candidates(p_lead_id uuid)
returns table (user_id uuid, full_name text, role text, team text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.role, u.team, u.avatar_path
  from public.afc_users u
  where u.is_active
    and u.role in ('dgm', 'agm', 'srm', 'general_manager')
    and exists (select 1 from public.afc_users me where me.id = auth.uid() and me.committee = 'PMT')
    and not exists (
      select 1 from public.lead_chat_participants p
      where p.lead_id = p_lead_id and p.user_id = u.id
    )
  order by u.full_name;
$$;

revoke all on function public.get_lead_chat_add_candidates(uuid) from public;
grant execute on function public.get_lead_chat_add_candidates(uuid) to authenticated;
