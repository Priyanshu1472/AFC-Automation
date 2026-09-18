-- Replaces the old "any PO-tier team member can pick up an unassigned lead"
-- model with targeted forwarding: a PA/AC creator (or PMT, on transfer)
-- names one specific person, who alone gets to assign PR/Reviewer/
-- Recommending Authority. The "po_assignment" status/meaning is unchanged
-- (still "awaiting PR/Reviewer/RA assignment") — only who may act on it
-- narrows from a role+team check to this exact person.
alter table public.leads
  add column if not exists forwarded_to_id uuid references public.afc_users(id);

-- Team-member picker for the "Forward to:" dropdowns (lead creation and PMT
-- transfer). Joins through afc_user_teams (not the afc_users.team scalar)
-- so multi-team secondary members are included. Only exposes full_name/role
-- — same sensitivity level as get_team_business_associates, no pin_hash or
-- other sensitive afc_users columns.
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
  order by u.full_name;
$$;

revoke all on function public.get_team_members(text) from public;
grant execute on function public.get_team_members(text) to authenticated;
