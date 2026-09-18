-- get_team_members feeds the "Forward to:" pickers (lead creation by an
-- Associate Consultant/Project Assistant, and PMT transfer) — a Business
-- Partner has a team (for the BP-org lookup elsewhere) but isn't staff and
-- can't be forwarded a lead to assign PR/Reviewer/Recommending Authority.
create or replace function public.get_team_members(p_team text)
returns table (user_id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct u.id, u.full_name, u.role
  from public.afc_user_teams t
  join public.afc_users u on u.id = t.user_id
  where t.team = p_team
    and u.is_active
    and u.role <> 'business_associate'
  order by u.full_name;
$$;
