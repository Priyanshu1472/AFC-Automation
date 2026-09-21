-- get_team_members feeds the "Forward to:" pickers (lead creation by an
-- Associate Consultant/Project Assistant, and PMT transfer). Associate
-- Consultant/Project Assistant are excluded from the list itself, alongside
-- Business Partners — a lead shouldn't be forwarded to another person in
-- that same non-assigning tier.
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
    and u.role not in ('business_associate', 'associate_consultant', 'project_assistant')
  order by u.full_name;
$$;
