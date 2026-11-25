-- find_similar_leads() scored every lead regardless of status, so a brand
-- new lead with the same title/bid-number/document as one that was
-- already dropped still got flagged as a possible duplicate — pa_dropped
-- is the one genuine dead end, nothing left for anyone to duplicate work
-- on. md_declined is NOT excluded here: an MD decline sends the lead back
-- to pa_action_required for the Person Responsible to rework and
-- resubmit (see advance-lead-stage's md_review transitions) — it's still
-- a live lead, so a new lead matching it should still be flagged. Same
-- signature, used unchanged by LeadForm.jsx's live hint and
-- create-lead/update-lead's save-time check (_shared/leadDuplicates.ts).
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
    where (p_exclude_id is null or l.id <> p_exclude_id)
      and l.status <> 'pa_dropped'
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
