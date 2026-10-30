-- The lead chat's "People in this chat" list shows each member's team as
-- well as their role (PMT can now add DGM-tier users from any team, so the
-- roster is routinely cross-team). Return type changes, so drop + recreate.

drop function if exists public.get_lead_chat_participant_names(uuid);
create function public.get_lead_chat_participant_names(p_lead_id uuid)
returns table (user_id uuid, full_name text, role text, avatar_path text, team text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.role, u.avatar_path, u.team
  from public.lead_chat_participants p
  join public.afc_users u on u.id = p.user_id
  where p.lead_id = p_lead_id
    and public.is_lead_chat_participant(p_lead_id)
  order by u.full_name;
$$;
revoke all on function public.get_lead_chat_participant_names(uuid) from public;
grant execute on function public.get_lead_chat_participant_names(uuid) to authenticated;
