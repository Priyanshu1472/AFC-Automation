-- @mention support for the Lead/Proposal/Empanelment chats: the tagging
-- dropdown needs each participant's role (shown as designation) and
-- avatar_path (profile photo), not just their name. Return type is
-- changing, so each function is dropped and recreated rather than just
-- replaced.

drop function if exists public.get_lead_chat_participant_names(uuid);
create function public.get_lead_chat_participant_names(p_lead_id uuid)
returns table (user_id uuid, full_name text, role text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.role, u.avatar_path
  from public.lead_chat_participants p
  join public.afc_users u on u.id = p.user_id
  where p.lead_id = p_lead_id
    and public.is_lead_chat_participant(p_lead_id);
$$;
revoke all on function public.get_lead_chat_participant_names(uuid) from public;
grant execute on function public.get_lead_chat_participant_names(uuid) to authenticated;

drop function if exists public.get_proposal_chat_participant_names(uuid);
create function public.get_proposal_chat_participant_names(p_proposal_id uuid)
returns table (user_id uuid, full_name text, role text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.role, u.avatar_path
  from public.proposal_chat_participants p
  join public.afc_users u on u.id = p.user_id
  where p.proposal_id = p_proposal_id
    and public.is_proposal_chat_participant(p_proposal_id);
$$;
revoke all on function public.get_proposal_chat_participant_names(uuid) from public;
grant execute on function public.get_proposal_chat_participant_names(uuid) to authenticated;

-- Empanelment has no roster table (participants are derived live from the
-- application row) — the old version of this function only listed people
-- who had already sent a message, which is fine for labelling a message's
-- sender but too narrow for @mention: the PO/DGM/CFO/CS/MD should all be
-- taggable even before they've said anything. Widened to the full
-- mentionable set, matching is_empanelment_chat_participant()'s own
-- membership test.
drop function if exists public.get_empanelment_chat_participant_names(uuid);
create function public.get_empanelment_chat_participant_names(p_application_id uuid)
returns table (user_id uuid, full_name text, role text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.role, u.avatar_path
  from public.empanelment_applications a
  join public.afc_users u on (
    u.id in (a.sent_by, a.project_officer_id, a.dgm_id)
    or (u.role in ('cfo', 'cs', 'md') and u.is_active)
  )
  where a.id = p_application_id
    and (public.is_empanelment_chat_participant(p_application_id) or public.current_afc_role() = 'admin');
$$;
revoke all on function public.get_empanelment_chat_participant_names(uuid) from public;
grant execute on function public.get_empanelment_chat_participant_names(uuid) to authenticated;
