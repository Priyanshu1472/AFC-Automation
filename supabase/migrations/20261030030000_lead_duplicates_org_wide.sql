-- Duplicate-lead detection goes org-wide. find_similar_leads only ever
-- compared against the caller's own team, so two teams could each add the
-- same tender with no warning at all. It now checks every lead in the
-- organisation (same-team and cross-team alike) and returns the matching
-- lead's team, so the form can say where the duplicate lives.
--
-- The form now asks for confirmation before saving a lead that has
-- matches, and if it's saved anyway, create-lead/update-lead record the
-- matches on leads.possible_duplicate_ids. The lead page shows them next
-- to the title via get_lead_duplicate_refs, which only hands back the
-- matching lead's title (and lets the UI link to it) when the viewer could
-- open that lead anyway — everyone else just sees its number and team.
--
-- Title similarity alone now needs >= 0.5 overlap (was 0.3): a match now
-- triggers a confirm dialog and a permanent flag, not just an inline hint,
-- so the loose threshold would flag too many unrelated leads.

drop function if exists public.find_similar_leads(text, text, text, text, bigint) cascade;
-- A legacy overload from the pre-lead-generation schema (it reads columns
-- like assignment_name/tender_id that no longer exist) was still around
-- live and makes untyped calls ambiguous — drop it too.
drop function if exists public.find_similar_leads(text, text, text, bigint, uuid, integer) cascade;

create or replace function public.find_similar_leads(
  p_title text,
  p_bid_number text default null,
  p_document_name text default null,
  p_document_size bigint default null,
  p_exclude_id uuid default null
)
returns table(id uuid, lead_number text, title text, status text, team text, score numeric, match_reason text)
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select
      l.id, l.lead_number, l.title, l.status, l.team,
      case when nullif(trim(p_bid_number), '') is not null and nullif(trim(l.bid_number), '') is not null
            and lower(trim(l.bid_number)) = lower(trim(p_bid_number)) then 1.0 else 0 end as bid_score,
      case when p_document_name is not null and p_document_size is not null
            and exists (
              select 1 from jsonb_array_elements(l.documents) d
              where d->>'name' = p_document_name
                and (d->>'size')::bigint = p_document_size
            ) then 1.0 else 0 end as doc_score,
      coalesce((
        select count(*)::numeric
        from unnest(public.afc_lead_tokens(l.title)) t
        where t = any (public.afc_lead_tokens(p_title))
      ) / nullif(greatest(
        array_length(public.afc_lead_tokens(l.title), 1),
        array_length(public.afc_lead_tokens(p_title), 1)
      ), 0), 0) as title_score
    from public.leads l
    where p_exclude_id is null or l.id <> p_exclude_id
  )
  select
    id, lead_number, title, status, team,
    greatest(bid_score, doc_score, title_score) as score,
    case
      when bid_score > 0 then 'Same bid/reference number'
      when doc_score > 0 then 'Same document uploaded'
      else 'Similar title'
    end as match_reason
  from scored
  where bid_score > 0 or doc_score > 0 or title_score >= 0.5
  order by score desc
  limit 5;
$$;

revoke all on function public.find_similar_leads(text, text, text, bigint, uuid) from public;
grant execute on function public.find_similar_leads(text, text, text, bigint, uuid) to authenticated;

alter table public.leads add column possible_duplicate_ids uuid[] not null default '{}';

create or replace function public.get_lead_duplicate_refs(p_lead_id uuid)
returns table (id uuid, lead_number text, team text, title text, can_view boolean)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.lead_number, d.team,
         case when public.can_view_lead(d.id) then d.title end,
         public.can_view_lead(d.id)
  from public.leads src
  join public.leads d on d.id = any (src.possible_duplicate_ids)
  where src.id = p_lead_id
    and public.can_view_lead(p_lead_id)
  order by d.created_at;
$$;

revoke all on function public.get_lead_duplicate_refs(uuid) from public;
grant execute on function public.get_lead_duplicate_refs(uuid) to authenticated;
