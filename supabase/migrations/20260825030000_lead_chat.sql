-- Per-lead group chat. Chat only opens once a lead clears the DGM's
-- initial gate and is forwarded to PMT (dgm_initial_approve, set by
-- advance-lead-stage) — leads.chat_opened_at is null until then, and the
-- chat panel/API stay inert before it's set. Once opened it never closes
-- again except to new messages (see lead_chat_messages RLS/edge-function
-- gate on leads.status = 'md_approved') — a decline leaves it open.
--
-- Roster (lead_chat_participants) grows as the lead moves forward: Person
-- Responsible/Reviewer/Approval Authority plus every PMT member when the
-- chat opens, every MD when it reaches md_review, every PMT Extended
-- member on escalation, every G3 (DGM) member on forward-to-DGM — added in
-- advance-lead-stage, not here. A participant keeps read access to the
-- chat's full history even after the lead moves past their stage (see
-- is_lead_chat_participant() below), which is what makes "the committee
-- stays in the loop" actually hold once can_view_lead()'s per-stage
-- committee clause no longer covers them.

alter table public.leads add column if not exists chat_opened_at timestamptz;

create table public.lead_chat_participants (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  user_id     uuid not null references public.afc_users(id),
  role_at_add text not null,
  added_at    timestamptz not null default now(),
  unique (lead_id, user_id)
);

create table public.lead_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  sender_id   uuid not null references public.afc_users(id),
  message     text not null,
  created_at  timestamptz not null default now()
);

create index lead_chat_participants_lead_idx on public.lead_chat_participants(lead_id);
create index lead_chat_messages_lead_idx      on public.lead_chat_messages(lead_id, created_at);

-- ── RLS ─────────────────────────────────────────────────────────
alter table public.lead_chat_participants enable row level security;
alter table public.lead_chat_messages     enable row level security;

-- Bypasses RLS on lead_chat_participants itself (SECURITY DEFINER) so the
-- policies below can reference it without self-recursion.
create or replace function public.is_lead_chat_participant(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lead_chat_participants p
    where p.lead_id = p_lead_id and p.user_id = auth.uid()
  );
$$;

-- Visible to anyone who can currently view the lead (can_view_lead, defined
-- in the lead-generation migrations) OR anyone who was ever added to the
-- roster — the second clause is what keeps history visible to a committee
-- member after the lead has moved past their stage.
create policy lead_chat_participants_select on public.lead_chat_participants
for select using (public.can_view_lead(lead_id) or public.is_lead_chat_participant(lead_id));

create policy lead_chat_messages_select on public.lead_chat_messages
for select using (public.can_view_lead(lead_id) or public.is_lead_chat_participant(lead_id));

-- No authenticated INSERT/UPDATE/DELETE policies on either table — same
-- convention as every other table in this module. All writes go through
-- send-lead-chat-message (messages) or advance-lead-stage (participants),
-- both service-role.

alter publication supabase_realtime add table public.lead_chat_messages;
