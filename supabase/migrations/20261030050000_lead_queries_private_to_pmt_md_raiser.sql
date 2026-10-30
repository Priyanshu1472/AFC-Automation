-- Cross-team queries were readable by anyone who could view the lead
-- (lead_queries_select = can_view_lead OR raiser) — including the lead's
-- own team, who shouldn't know another team has queried their lead.
-- Now only PMT, MD (and admin, which sees everything read-only) and the
-- query's own raiser see it. The same applies to the query's entries in
-- the lead's activity timeline, and to get_lead_query_names.

create or replace function public.can_see_lead_query(p_raised_by_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_raised_by_id = auth.uid()
    or public.current_afc_role() in ('md', 'admin')
    or exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT');
$$;

revoke all on function public.can_see_lead_query(uuid) from public;
grant execute on function public.can_see_lead_query(uuid) to authenticated;

drop policy if exists lead_queries_select on public.lead_queries;
create policy lead_queries_select on public.lead_queries
for select using (public.can_see_lead_query(raised_by_id));

-- Query-only timeline entries: visible to PMT/MD/admin, and to anyone who
-- has raised a query on this lead (so a raiser sees PMT's response to it).
-- Entries that actually change the lead (team_transfer, reopened_to_pmt)
-- stay visible to everyone who can view the lead.
drop policy if exists lead_activity_log_select on public.lead_activity_log;
create policy lead_activity_log_select on public.lead_activity_log
for select using (
  public.can_view_lead(lead_id)
  and (
    action not in (
      'cross_team_query_raised', 'cross_team_query_edited', 'cross_team_query_withdrawn',
      'cross_team_query_reminder_sent', 'cross_team_query_added_to_chat', 'cross_team_query_declined',
      'lead_transfer_requested', 'lead_transfer_rejected'
    )
    or public.can_see_lead_query(null)
    or exists (
      select 1 from public.lead_queries q
      where q.lead_id = lead_activity_log.lead_id and q.raised_by_id = auth.uid()
    )
  )
);

create or replace function public.get_lead_query_names(p_lead_id uuid)
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name
  from public.afc_users u
  where public.can_view_lead(p_lead_id)
    and u.id in (
      select raised_by_id from public.lead_queries q where q.lead_id = p_lead_id and public.can_see_lead_query(q.raised_by_id)
      union
      select resolved_by_id from public.lead_queries q where q.lead_id = p_lead_id and q.resolved_by_id is not null and public.can_see_lead_query(q.raised_by_id)
      union
      select md_decided_by_id from public.lead_queries q where q.lead_id = p_lead_id and q.md_decided_by_id is not null and public.can_see_lead_query(q.raised_by_id)
      union
      select transfer_forwarded_to_id from public.lead_queries q where q.lead_id = p_lead_id and q.transfer_forwarded_to_id is not null and public.can_see_lead_query(q.raised_by_id)
    );
$$;
