-- Read-tracking for the per-lead chat, backing the unread-count badge shown
-- next to the "View" icon on the leads list. Two SECURITY DEFINER RPCs
-- (same convention as mark_notification_read/mark_all_notifications_read,
-- 20260720120000_notifications.sql) rather than a new edge function — both
-- only ever touch the caller's own participant row(s), so there's nothing
-- for a service-role function to authorize beyond what auth.uid() already
-- gives for free.

alter table public.lead_chat_participants add column if not exists last_read_at timestamptz;

-- Called by LeadChatPanel whenever it's open/showing messages — marks the
-- caller caught up on this lead's chat as of now. No-op (0 rows affected)
-- if the caller isn't actually a participant.
create or replace function public.mark_lead_chat_read(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lead_chat_participants
  set last_read_at = now()
  where lead_id = p_lead_id and user_id = auth.uid();
end;
$$;

revoke all on function public.mark_lead_chat_read(uuid) from public;
grant execute on function public.mark_lead_chat_read(uuid) to authenticated;

-- Called by LeadListPage once, for every lead the caller participates in at
-- once — an unread message is one not sent by the caller and posted after
-- their last_read_at (or after they were added, if they've never read it).
create or replace function public.lead_chat_unread_counts()
returns table(lead_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.lead_id, count(*)
  from public.lead_chat_messages m
  join public.lead_chat_participants p on p.lead_id = m.lead_id and p.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.created_at > coalesce(p.last_read_at, p.added_at)
  group by m.lead_id;
$$;

revoke all on function public.lead_chat_unread_counts() from public;
grant execute on function public.lead_chat_unread_counts() to authenticated;
