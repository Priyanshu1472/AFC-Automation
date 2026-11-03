-- G3 committee escalation for conflicting PMT-stage leads.
--
-- PMT can, instead of (or alongside, across a separate call) recommending a
-- pmt_review lead to MD, escalate it together with any other pmt_review
-- leads it conflicts with (e.g. two teams independently chasing the same
-- opportunity). All member leads move to the new 'g3_review' status; MD
-- sees the whole conflict set and accepts exactly one, which — since only
-- pmt_review leads are eligible, i.e. already past Recommending Authority —
-- resumes straight at md_review. Every other member lead is auto-dropped.
--
-- This is NOT a revival of the old mandatory "G3" stage removed in
-- 20260928000000_lead_committee_and_status_simplification.sql (that was a
-- universal per-lead gate that didn't work for Head Office). This one is
-- optional, PMT-triggered, and only ever involves leads PMT explicitly
-- flags as conflicting with each other.

alter table public.afc_users drop constraint if exists afc_users_committee_check;
alter table public.afc_users add constraint afc_users_committee_check
  check (committee is null or committee in ('PMT', 'G3'));

alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check check (status in (
  'po_assignment', 'pa_review', 'recommending_authority_review', 'pmt_review', 'g3_review', 'md_review',
  'pa_action_required', 'pa_dropped', 'md_approved', 'md_declined'
));

create table public.lead_g3_escalations (
  id               uuid primary key default gen_random_uuid(),
  raised_lead_id   uuid not null references public.leads(id),
  raised_by_id     uuid not null references public.afc_users(id),
  pmt_comment      text,
  status           text not null default 'open' check (status in ('open', 'resolved')),
  accepted_lead_id uuid references public.leads(id),
  resolved_by_id   uuid references public.afc_users(id),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);

create table public.lead_g3_escalation_members (
  id            uuid primary key default gen_random_uuid(),
  escalation_id uuid not null references public.lead_g3_escalations(id) on delete cascade,
  lead_id       uuid not null references public.leads(id),
  unique (escalation_id, lead_id)
);

create index lead_g3_escalation_members_escalation_idx on public.lead_g3_escalation_members(escalation_id);
create index lead_g3_escalation_members_lead_idx on public.lead_g3_escalation_members(lead_id);

alter table public.lead_g3_escalations enable row level security;
alter table public.lead_g3_escalation_members enable row level security;

-- Only MD/admin and G3 committee members ever see an escalation — PMT (the
-- raiser included) loses visibility the moment it's created, matching the
-- chat-access rule below. All writes go through escalate-lead-to-g3 and
-- resolve-g3-escalation (service role), so no insert/update/delete policy
-- is needed for `authenticated`.
create or replace function public.can_view_g3_escalation()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_afc_role() in ('md', 'admin')
    or exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'G3');
$$;

revoke all on function public.can_view_g3_escalation() from public;
grant execute on function public.can_view_g3_escalation() to authenticated;

create policy lead_g3_escalations_select on public.lead_g3_escalations
for select using (public.can_view_g3_escalation());

create policy lead_g3_escalation_members_select on public.lead_g3_escalation_members
for select using (public.can_view_g3_escalation());

-- The MD decision panel needs the whole conflict set (lead number, title,
-- team) regardless of which member lead's page it's being viewed from —
-- one call instead of a join the frontend would otherwise need RLS access
-- to assemble itself (G3/MD may not otherwise have can_view_lead on every
-- member lead's own team-scoped fields).
create or replace function public.get_g3_escalation_for_lead(p_lead_id uuid)
returns table (
  escalation_id uuid,
  pmt_comment text,
  created_at timestamptz,
  member_lead_id uuid,
  lead_number text,
  title text,
  team text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.pmt_comment, e.created_at, l.id, l.lead_number, l.title, l.team
  from public.lead_g3_escalations e
  join public.lead_g3_escalation_members m on m.escalation_id = e.id
  join public.leads l on l.id = m.lead_id
  where e.status = 'open'
    and public.can_view_g3_escalation()
    and exists (
      select 1 from public.lead_g3_escalation_members m2
      where m2.escalation_id = e.id and m2.lead_id = p_lead_id
    )
  order by l.lead_number;
$$;

revoke all on function public.get_g3_escalation_for_lead(uuid) from public;
grant execute on function public.get_g3_escalation_for_lead(uuid) to authenticated;
