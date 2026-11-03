-- G3 escalation visibility narrows from "every G3 committee member,
-- org-wide" to "only the specific G3 members PMT selected when escalating"
-- — PMT now picks exactly who an escalation goes to (a searchable
-- multi-select alongside the conflicting-leads picker), and only those
-- people (plus MD/admin) ever see it or gain chat access.

drop policy if exists lead_g3_escalations_select on public.lead_g3_escalations;
drop policy if exists lead_g3_escalation_members_select on public.lead_g3_escalation_members;
drop function if exists public.can_view_g3_escalation();

create table public.lead_g3_escalation_assignees (
  id            uuid primary key default gen_random_uuid(),
  escalation_id uuid not null references public.lead_g3_escalations(id) on delete cascade,
  user_id       uuid not null references public.afc_users(id),
  unique (escalation_id, user_id)
);

create index lead_g3_escalation_assignees_escalation_idx on public.lead_g3_escalation_assignees(escalation_id);

alter table public.lead_g3_escalation_assignees enable row level security;

create or replace function public.can_view_g3_escalation(p_escalation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_afc_role() in ('md', 'admin')
    or exists (
      select 1 from public.lead_g3_escalation_assignees a
      where a.escalation_id = p_escalation_id and a.user_id = auth.uid()
    );
$$;

revoke all on function public.can_view_g3_escalation(uuid) from public;
grant execute on function public.can_view_g3_escalation(uuid) to authenticated;

create policy lead_g3_escalations_select on public.lead_g3_escalations
for select using (public.can_view_g3_escalation(id));

create policy lead_g3_escalation_members_select on public.lead_g3_escalation_members
for select using (public.can_view_g3_escalation(escalation_id));

create policy lead_g3_escalation_assignees_select on public.lead_g3_escalation_assignees
for select using (public.can_view_g3_escalation(escalation_id));

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
    and public.can_view_g3_escalation(e.id)
    and exists (
      select 1 from public.lead_g3_escalation_members m2
      where m2.escalation_id = e.id and m2.lead_id = p_lead_id
    )
  order by l.lead_number;
$$;

revoke all on function public.get_g3_escalation_for_lead(uuid) from public;
grant execute on function public.get_g3_escalation_for_lead(uuid) to authenticated;
