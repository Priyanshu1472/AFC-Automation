-- Admin gets org-wide VIEW-ONLY access to the Lead Generation module (for
-- the new "Lead Activity" tab on Audit Logs) — but explicitly never the
-- chat. can_view_lead() already includes 'admin' (see
-- 20260903030000_lead_committee_visibility_through_pipeline.sql) so admin
-- keeps full read access to `leads`/`lead_activity_log` unchanged; this
-- migration only narrows the two lead-chat tables, which were otherwise
-- ALSO readable by admin as a side effect of reusing can_view_lead() in
-- their own SELECT policies. Writes were never possible for admin anyway —
-- send-lead-chat-message requires roster membership
-- (lead_chat_participants), and admin is never added to any lead's roster.
drop policy if exists lead_chat_participants_select on public.lead_chat_participants;
create policy lead_chat_participants_select on public.lead_chat_participants
for select using (
  (public.can_view_lead(lead_id) and public.current_afc_role() != 'admin')
  or public.is_lead_chat_participant(lead_id)
);

drop policy if exists lead_chat_messages_select on public.lead_chat_messages;
create policy lead_chat_messages_select on public.lead_chat_messages
for select using (
  (public.can_view_lead(lead_id) and public.current_afc_role() != 'admin')
  or public.is_lead_chat_participant(lead_id)
);
