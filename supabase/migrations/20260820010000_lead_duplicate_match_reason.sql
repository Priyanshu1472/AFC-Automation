-- find_similar_leads scores a candidate lead by the greatest of three
-- independent signals (exact bid number, exact document name+size, title
-- token overlap) — a bid-number-only match with a completely different
-- title was surfacing as a bare "possible duplicate lead" with no
-- indication *why*, which reads as a false positive on title similarity
-- even though title never matched at all. Adding match_reason lets the
-- frontend say which signal actually triggered, instead of leaving the
-- title comparison to take the blame for a bid-number coincidence.
--
-- Return type is changing (new column), so the old signature has to be
-- dropped first — CREATE OR REPLACE FUNCTION can't change a function's
-- return type in place.
drop function if exists public.find_similar_leads(text, text, text, text, bigint) cascade;

create or replace function public.find_similar_leads(
  p_title text,
  p_team text,
  p_bid_number text default null,
  p_document_name text default null,
  p_document_size bigint default null
)
returns table(id uuid, lead_number text, title text, status text, score numeric, match_reason text)
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select
      l.id, l.lead_number, l.title, l.status,
      case when p_bid_number is not null and l.bid_number is not null
            and lower(l.bid_number) = lower(p_bid_number) then 1.0 else 0 end as bid_score,
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
    where l.team = p_team
  )
  select
    id, lead_number, title, status,
    greatest(bid_score, doc_score, title_score) as score,
    case
      when bid_score > 0 and bid_score >= greatest(doc_score, title_score) then 'Same bid/reference number'
      when doc_score > 0 and doc_score >= greatest(bid_score, title_score) then 'Same document uploaded'
      when title_score > 0 then 'Similar title'
      else null
    end as match_reason
  from scored
  where greatest(bid_score, doc_score, title_score) >= 0.3
  order by score desc
  limit 5;
$$;

revoke all on function public.find_similar_leads(text, text, text, text, bigint) from public;
grant execute on function public.find_similar_leads(text, text, text, text, bigint) to authenticated;
