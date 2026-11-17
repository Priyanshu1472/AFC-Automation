-- WhatsApp-style "X was added" lines in every roster-based chat (lead chat
-- and proposal chat), plus a notification to the person added.
--
-- Done as AFTER INSERT triggers on the two roster tables rather than in
-- each edge function, so every path that adds someone — chat opening,
-- stage advances (PMT/MD), G3 escalation, cross-team query, PMT's "Add
-- member", additional Person Responsible, Accounts Committee joining a
-- proposal — gets the same line without each caller having to remember.
-- (Empanelment chat has no roster table — membership is derived live from
-- the application — so there is nothing to announce there.)
--
-- The line is a message with sender_id NULL and system_kind
-- 'member_added'; the UI renders it as a centred grey line and groups
-- consecutive ones. These lines never count as unread.
--
-- Notification: the person added is told, except for the automatic
-- seeding where they already get their own, more specific notification at
-- the same moment (named assignees and MD when a chat opens, PMT/G3 when a
-- lead reaches them, a cross-team query raiser, an additional Person
-- Responsible).

alter table public.lead_chat_participants     add column if not exists added_by uuid references public.afc_users(id) on delete set null;
alter table public.proposal_chat_participants add column if not exists added_by uuid references public.afc_users(id) on delete set null;
alter table public.lead_chat_messages         add column if not exists system_kind text;
alter table public.proposal_chat_messages     add column if not exists system_kind text;

create or replace function public.chat_member_added_text(p_user_id uuid, p_added_by uuid, p_role_at_add text)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.afc_users where id = p_user_id), 'Someone')
    || case
         when p_added_by is not null and p_added_by <> p_user_id
           then ' was added by ' || coalesce((select full_name from public.afc_users where id = p_added_by), 'someone')
         else ' was added'
       end
    || case p_role_at_add
         when 'md' then ' (Managing Director)'
         when 'PMT' then ' (PMT Committee)'
         when 'g3' then ' (G3 Committee)'
         when 'accounts' then ' (Accounts Committee)'
         when 'cross_team_query' then ' via a cross-team query'
         when 'additional_pr' then ' as an additional Person Responsible'
         else ''
       end;
$$;
revoke all on function public.chat_member_added_text(uuid, uuid, text) from public;

create or replace function public.chat_member_added_should_notify(p_role_at_add text)
returns boolean
language sql immutable as $$
  select p_role_at_add not in ('named', 'md', 'PMT', 'g3', 'cross_team_query', 'additional_pr');
$$;

-- ── Lead chat ───────────────────────────────────────────────────────
create or replace function public.on_lead_chat_participant_added()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_lead record;
  v_adder text;
begin
  insert into public.lead_chat_messages (lead_id, sender_id, message, system_kind)
  values (new.lead_id, null, public.chat_member_added_text(new.user_id, new.added_by, new.role_at_add), 'member_added');

  if public.chat_member_added_should_notify(new.role_at_add) and new.user_id is distinct from new.added_by then
    select id, lead_number, title into v_lead from public.leads where id = new.lead_id;
    select full_name into v_adder from public.afc_users where id = new.added_by;
    insert into public.notifications (user_id, title, sub_text, type, link, kind)
    values (
      new.user_id,
      'Added to a lead discussion',
      coalesce(v_adder, 'You were') || case when v_adder is null then ' added' else ' added you' end
        || ' to the discussion on ' || coalesce(v_lead.lead_number, 'a lead') || ' — "' || coalesce(v_lead.title, '') || '".',
      'info',
      '/leads/' || new.lead_id,
      'chat_member_added'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists lead_chat_participant_added on public.lead_chat_participants;
create trigger lead_chat_participant_added
after insert on public.lead_chat_participants
for each row execute function public.on_lead_chat_participant_added();

-- ── Proposal chat ───────────────────────────────────────────────────
create or replace function public.on_proposal_chat_participant_added()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_lead record;
  v_adder text;
begin
  insert into public.proposal_chat_messages (proposal_id, sender_id, message, system_kind)
  values (new.proposal_id, null, public.chat_member_added_text(new.user_id, new.added_by, new.role_at_add), 'member_added');

  if public.chat_member_added_should_notify(new.role_at_add) and new.user_id is distinct from new.added_by then
    select l.id, l.lead_number, l.title into v_lead
    from public.proposal_preparations pp join public.leads l on l.id = pp.lead_id
    where pp.id = new.proposal_id;
    select full_name into v_adder from public.afc_users where id = new.added_by;
    insert into public.notifications (user_id, title, sub_text, type, link, kind)
    values (
      new.user_id,
      'Added to a proposal discussion',
      coalesce(v_adder, 'You were') || case when v_adder is null then ' added' else ' added you' end
        || ' to the discussion on the proposal for ' || coalesce(v_lead.lead_number, 'a lead') || ' — "' || coalesce(v_lead.title, '') || '".',
      'info',
      '/proposals/' || v_lead.id,
      'chat_member_added'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists proposal_chat_participant_added on public.proposal_chat_participants;
create trigger proposal_chat_participant_added
after insert on public.proposal_chat_participants
for each row execute function public.on_proposal_chat_participant_added();

-- ── Unread counts ignore the system lines ───────────────────────────
create or replace function public.lead_chat_unread_counts()
returns table(lead_id uuid, unread_count bigint)
language sql stable security definer set search_path = public as $$
  select m.lead_id, count(*)
  from public.lead_chat_messages m
  join public.lead_chat_participants p on p.lead_id = m.lead_id and p.user_id = auth.uid()
  where (m.sender_id is null or m.sender_id <> auth.uid())
    and m.system_kind is null
    and m.created_at > coalesce(p.last_read_at, p.added_at)
  group by m.lead_id;
$$;

create or replace function public.proposal_chat_unread_counts()
returns table(proposal_id uuid, unread_count bigint)
language sql stable security definer set search_path = public as $$
  select m.proposal_id, count(*)
  from public.proposal_chat_messages m
  join public.proposal_chat_participants p on p.proposal_id = m.proposal_id and p.user_id = auth.uid()
  where (m.sender_id is null or m.sender_id <> auth.uid())
    and m.system_kind is null
    and m.created_at > coalesce(p.last_read_at, p.added_at)
  group by m.proposal_id;
$$;

-- ── Proposal chat roster now shows team too (like the lead chat) ────
drop function if exists public.get_proposal_chat_participant_names(uuid);
create function public.get_proposal_chat_participant_names(p_proposal_id uuid)
returns table (user_id uuid, full_name text, role text, avatar_path text, team text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name, u.role, u.avatar_path, u.team
  from public.proposal_chat_participants p
  join public.afc_users u on u.id = p.user_id
  where p.proposal_id = p_proposal_id
    and public.is_proposal_chat_participant(p_proposal_id)
  order by u.full_name;
$$;
revoke all on function public.get_proposal_chat_participant_names(uuid) from public;
grant execute on function public.get_proposal_chat_participant_names(uuid) to authenticated;

-- ── Accounts Committee joins chats that already reached them ────────
-- Going forward decide-fee-note-md adds them when the MD approves the
-- Bid Payment Requisition Note. Backfill quietly (no lines/notifications)
-- for notes approved before this migration.
alter table public.proposal_chat_participants disable trigger proposal_chat_participant_added;

insert into public.proposal_chat_participants (proposal_id, user_id, role_at_add)
select fn.proposal_id, c.user_id, 'accounts'
from public.fee_notes fn
join public.afc_user_committees c on c.committee = 'Accounts'
join public.afc_users u on u.id = c.user_id and u.is_active
where fn.status = 'approved'
on conflict (proposal_id, user_id) do nothing;

alter table public.proposal_chat_participants enable trigger proposal_chat_participant_added;

-- The proposal chat bubble now checks roster membership before rendering
-- (same as the lead chat).
revoke all on function public.is_proposal_chat_participant(uuid) from public;
grant execute on function public.is_proposal_chat_participant(uuid) to authenticated, service_role;
