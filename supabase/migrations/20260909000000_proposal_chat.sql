-- Per-proposal group chat — same shape as the per-lead chat
-- (20260825030000_lead_chat.sql), but keyed off proposal_preparations
-- instead of leads, since a proposal's own lifecycle (locked ->
-- client_response) is what should open/close it, not the lead's status
-- (which is already 'md_approved', terminal, by the time a proposal even
-- exists — the lead chat's own close condition literally can't apply
-- here).
--
-- Roster (proposal_chat_participants), all added at creation time in
-- create-proposal-preparation — unlike leads, a proposal has no committee
-- pipeline to grow the roster stage by stage, so this is a one-time sync,
-- not an accumulator:
--   - Person Responsible / Reviewer / Approval Authority (the lead's own
--     three assignees)
--   - the lead's assigned Business Partner (assigned_ba_id), if any —
--     only on their own proposal, never every proposal
--   - every MD, org-wide, on every proposal
--
-- Chat opens immediately on creation (chat_opened_at set in the same
-- insert) and closes once the proposal is locked — either manually
-- (proposal_preparations.locked) or because the lead's submission_deadline
-- has passed (same "effectively locked" rule as isProposalLocked() in
-- src/lib/proposalPrep.js and the DB's can_edit_proposal()) — see
-- send-proposal-chat-message, which enforces this the same way
-- send-lead-chat-message enforces leads.status = 'md_approved'.

alter table public.proposal_preparations add column if not exists chat_opened_at timestamptz;

create table public.proposal_chat_participants (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposal_preparations(id) on delete cascade,
  user_id      uuid not null references public.afc_users(id),
  role_at_add  text not null,
  added_at     timestamptz not null default now(),
  last_read_at timestamptz,
  unique (proposal_id, user_id)
);

create table public.proposal_chat_messages (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposal_preparations(id) on delete cascade,
  sender_id    uuid not null references public.afc_users(id),
  message      text not null,
  created_at   timestamptz not null default now()
);

create index proposal_chat_participants_proposal_idx on public.proposal_chat_participants(proposal_id);
create index proposal_chat_messages_proposal_idx      on public.proposal_chat_messages(proposal_id, created_at);

-- ── RLS ─────────────────────────────────────────────────────────
alter table public.proposal_chat_participants enable row level security;
alter table public.proposal_chat_messages     enable row level security;

-- Bypasses RLS on proposal_chat_participants itself (SECURITY DEFINER) so
-- the policies below can reference it without self-recursion — same
-- pattern as is_lead_chat_participant().
create or replace function public.is_proposal_chat_participant(p_proposal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.proposal_chat_participants p
    where p.proposal_id = p_proposal_id and p.user_id = auth.uid()
  );
$$;

-- Mirrors proposal_preparations_select (20260821000000): visibility is
-- can_view_lead() on the proposal's own lead, resolved via a join since
-- these tables key off proposal_id, not lead_id directly. SECURITY
-- DEFINER so this can read proposal_preparations regardless of the
-- caller's own RLS access to it.
create or replace function public.can_view_proposal_chat(p_proposal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_lead(pp.lead_id)
  from public.proposal_preparations pp
  where pp.id = p_proposal_id;
$$;

create policy proposal_chat_participants_select on public.proposal_chat_participants
for select using (public.can_view_proposal_chat(proposal_id) or public.is_proposal_chat_participant(proposal_id));

create policy proposal_chat_messages_select on public.proposal_chat_messages
for select using (public.can_view_proposal_chat(proposal_id) or public.is_proposal_chat_participant(proposal_id));

-- No authenticated INSERT/UPDATE/DELETE policies on either table — same
-- convention as lead_chat_*. All writes go through send-proposal-chat-
-- message (messages) or create-proposal-preparation (participants), both
-- service-role.

alter publication supabase_realtime add table public.proposal_chat_messages;

-- ── Read-tracking (mirrors 20260827000000_lead_chat_read_tracking.sql) ──
create or replace function public.mark_proposal_chat_read(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.proposal_chat_participants
  set last_read_at = now()
  where proposal_id = p_proposal_id and user_id = auth.uid();
end;
$$;

revoke all on function public.mark_proposal_chat_read(uuid) from public;
grant execute on function public.mark_proposal_chat_read(uuid) to authenticated;

create or replace function public.proposal_chat_unread_counts()
returns table(proposal_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.proposal_id, count(*)
  from public.proposal_chat_messages m
  join public.proposal_chat_participants p on p.proposal_id = m.proposal_id and p.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.created_at > coalesce(p.last_read_at, p.added_at)
  group by m.proposal_id;
$$;

revoke all on function public.proposal_chat_unread_counts() from public;
grant execute on function public.proposal_chat_unread_counts() to authenticated;
