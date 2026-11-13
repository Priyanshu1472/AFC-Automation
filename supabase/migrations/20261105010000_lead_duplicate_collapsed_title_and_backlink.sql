-- Two duplicate-detection gaps:
--
-- 1. Title matching tokenizes on whitespace after stripping punctuation
--    (afc_lead_tokens), so "Third Party Quality Monitoring" and
--    "ThirdParty Quality Monitoring" score low/zero on that word even
--    though they're the same text typed with different spacing. Add a
--    second, stricter signal: strip EVERY non-alphanumeric character
--    (spaces included, not just punctuation) and compare the two titles
--    for exact equality — "How are you?" and "how-are-you" both collapse
--    to "howareyou" and now score a full match regardless of spacing or
--    punctuation style.
--
-- 2. A possible-duplicate flag only ever landed on the NEW lead being
--    saved — the earlier, already-existing lead it matched against never
--    got flagged or notified, even though it's just as much a possible
--    duplicate from that lead's own point of view. Fixed in
--    create-lead/update-lead (_shared/leadDuplicates.ts), not here — this
--    migration only adds the matching signal those functions then act on.

create or replace function public.afc_collapsed_lead_text(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '', 'g');
$$;

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
      case when nullif(public.afc_collapsed_lead_text(l.title), '') is not null
            and public.afc_collapsed_lead_text(l.title) = public.afc_collapsed_lead_text(p_title)
           then 1.0 else 0 end as collapsed_title_score,
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
    greatest(bid_score, doc_score, collapsed_title_score, title_score) as score,
    case
      when bid_score > 0 then 'Same bid/reference number'
      when doc_score > 0 then 'Same document uploaded'
      when collapsed_title_score > 0 then 'Same title'
      else 'Similar title'
    end as match_reason
  from scored
  where bid_score > 0 or doc_score > 0 or collapsed_title_score > 0 or title_score >= 0.5
  order by score desc
  limit 5;
$$;

revoke all on function public.find_similar_leads(text, text, text, bigint, uuid) from public;
grant execute on function public.find_similar_leads(text, text, text, bigint, uuid) to authenticated;
