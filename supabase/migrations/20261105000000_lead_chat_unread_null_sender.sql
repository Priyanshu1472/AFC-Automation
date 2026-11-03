-- System/bot chat announcements (e.g. escalate-lead-to-g3's G3 notice) now
-- post with sender_id = null, rendered as "AFC Bot" on the frontend — but
-- lead_chat_unread_counts()'s own `m.sender_id <> auth.uid()` filter
-- silently excludes any row where sender_id is null (NULL <> x evaluates
-- to NULL, not true, so the WHERE clause drops it), meaning a bot message
-- would never count as unread or badge the chat bubble. Treat a null
-- sender the same as "not me."

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
  where (m.sender_id is null or m.sender_id <> auth.uid())
    and m.created_at > coalesce(p.last_read_at, p.added_at)
  group by m.lead_id;
$$;
