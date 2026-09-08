-- advance-lead-stage now adds a lead's team DGM(s) as standing chat
-- participants at the same point PMT is added (chat_opened_at set), so
-- every team DGM can view and take part in every one of their team's lead
-- chats — not just whichever DGM happened to act on dgm_initial_approve.
-- This backfills that same roster addition onto leads whose chat already
-- opened before this change shipped; can_view_lead() already grants team
-- DGMs read access (see 20260904020000), this only adds the write access
-- lead_chat_participants membership gates in send-lead-chat-message.
insert into public.lead_chat_participants (lead_id, user_id, role_at_add)
select l.id, dgm.id, 'dgm'
from public.leads l
join public.afc_user_teams ut on ut.team = l.team
join public.afc_users dgm on dgm.id = ut.user_id and dgm.role = 'dgm' and dgm.is_active
where l.chat_opened_at is not null
on conflict (lead_id, user_id) do nothing;
