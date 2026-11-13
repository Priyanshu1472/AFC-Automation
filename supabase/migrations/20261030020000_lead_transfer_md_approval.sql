-- A PMT member can no longer transfer a lead on their own — answering a
-- cross-team query with "Transfer" now only *requests* it (status
-- 'transfer_pending', with the proposed team / forward-to person parked on
-- the query row), and MD approves (the transfer actually runs then) or
-- rejects (the query goes back to whatever it was before, so PMT can still
-- add-to-chat/decline/re-request). MD transferring directly stays instant.
--
-- resolved_by_role records whether pmt_response was written by PMT or MD,
-- so the query card can label it correctly — before this, an MD who
-- transferred directly still showed up as "PMT: …".

alter table public.lead_queries
  add column resolved_by_role         text check (resolved_by_role in ('pmt', 'md')),
  add column transfer_target_team     text,
  add column transfer_forwarded_to_id uuid references public.afc_users(id) on delete set null,
  add column pre_transfer_status      text,
  add column md_response              text,
  add column md_decided_by_id         uuid references public.afc_users(id) on delete set null,
  add column md_decided_at            timestamptz;

alter table public.lead_queries drop constraint lead_queries_status_check;
alter table public.lead_queries add constraint lead_queries_status_check
  check (status in ('open', 'added_to_chat', 'transfer_pending', 'transferred', 'declined', 'withdrawn'));

update public.lead_queries q
set resolved_by_role = case when u.role = 'md' then 'md' else 'pmt' end
from public.afc_users u
where u.id = q.resolved_by_id and q.resolved_by_role is null;

-- Also expose the MD decider and the proposed forward-to person, both of
-- which the query card now names.
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
      select raised_by_id from public.lead_queries where lead_id = p_lead_id
      union
      select resolved_by_id from public.lead_queries where lead_id = p_lead_id and resolved_by_id is not null
      union
      select md_decided_by_id from public.lead_queries where lead_id = p_lead_id and md_decided_by_id is not null
      union
      select transfer_forwarded_to_id from public.lead_queries where lead_id = p_lead_id and transfer_forwarded_to_id is not null
    );
$$;

revoke all on function public.get_lead_query_names(uuid) from public;
grant execute on function public.get_lead_query_names(uuid) to authenticated;
