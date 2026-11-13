-- Group chat-message notifications per record instead of one row per
-- message: a lead with 10 new messages should show as a single "You have
-- 10 unread messages" row on the dashboard, not 10 separate rows. A
-- mention is deliberately NOT grouped — it's sent as its own notification
-- (see send-*-chat-message's existing "tagged you" path), so grouping is
-- scoped to kind = 'chat_message' only via a partial unique index.

alter table public.notifications add column if not exists kind text;
alter table public.notifications add column if not exists message_count integer not null default 1;

-- Only one unread "chat_message" row per (user, link) at a time — the
-- target a new message either inserts fresh into or increments.
create unique index if not exists notifications_chat_group_unread_idx
  on public.notifications (user_id, link)
  where kind = 'chat_message' and is_read = false;

-- Called once per recipient from send-*-chat-message (service role only —
-- it writes an arbitrary user's notification row, so it's never exposed to
-- `authenticated`). Inserts the first "You have 1 unread message" row for
-- this user+link, or bumps the existing unread one's count/sub_text and
-- refreshes created_at so it floats back to the top.
create or replace function public.bump_chat_notification(p_user_id uuid, p_link text, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, title, sub_text, type, link, kind, message_count, is_read, created_at)
  values (p_user_id, p_title, 'You have 1 unread message', 'action_required', p_link, 'chat_message', 1, false, now())
  on conflict (user_id, link) where (kind = 'chat_message' and is_read = false)
  do update set
    message_count = notifications.message_count + 1,
    sub_text = 'You have ' || (notifications.message_count + 1) || ' unread messages',
    title = excluded.title,
    created_at = now();
end;
$$;

revoke all on function public.bump_chat_notification(uuid, text, text) from public;
grant execute on function public.bump_chat_notification(uuid, text, text) to service_role;

-- Opening a chat (which already marks the thread itself read) now also
-- clears the grouped chat_message notification and any chat_mention
-- notifications for that record, so the dashboard count drops back to 0
-- the moment the user has actually seen the messages.

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

  update public.notifications
  set is_read = true
  where user_id = auth.uid()
    and link = '/leads/' || p_lead_id::text
    and kind in ('chat_message', 'chat_mention');
end;
$$;

create or replace function public.mark_proposal_chat_read(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
begin
  update public.proposal_chat_participants
  set last_read_at = now()
  where proposal_id = p_proposal_id and user_id = auth.uid();

  select lead_id into v_lead_id from public.proposal_preparations where id = p_proposal_id;
  if v_lead_id is not null then
    update public.notifications
    set is_read = true
    where user_id = auth.uid()
      and link = '/proposals/' || v_lead_id::text
      and kind in ('chat_message', 'chat_mention');
  end if;
end;
$$;

create or replace function public.mark_empanelment_chat_read(p_application_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_empanelment_chat_participant(p_application_id) then
    return;
  end if;
  insert into public.empanelment_chat_reads (application_id, user_id, last_read_at)
  values (p_application_id, auth.uid(), now())
  on conflict (application_id, user_id) do update set last_read_at = excluded.last_read_at;

  update public.notifications
  set is_read = true
  where user_id = auth.uid()
    and link = '/empanelment/' || p_application_id::text
    and kind in ('chat_message', 'chat_mention');
end;
$$;
