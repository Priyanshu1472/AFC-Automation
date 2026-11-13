-- "Active proposal" for person_active_lead_and_proposal_counts (see
-- 20260930010000) was originally defined as client_response is null, but
-- product wants it keyed off `locked` instead — a proposal not yet locked
-- in (still being worked on) counts as active; once locked (submitted,
-- awaiting the client's decision) it no longer does, regardless of
-- client_response.
create or replace function public.person_active_lead_and_proposal_counts(p_user_ids uuid[])
returns table (user_id uuid, active_leads bigint, active_proposals bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    cand.id as user_id,
    (
      select count(*) from public.leads l
      where l.person_responsible_id = cand.id
        and l.status not in ('md_approved', 'md_declined', 'pa_dropped')
    ) as active_leads,
    (
      select count(*) from public.proposal_preparations pp
      join public.leads l2 on l2.id = pp.lead_id
      where l2.person_responsible_id = cand.id
        and coalesce(pp.locked, false) = false
    ) as active_proposals
  from unnest(p_user_ids) as cand(id);
$$;
