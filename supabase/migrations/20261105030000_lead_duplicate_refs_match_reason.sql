-- The lead page's "Possible duplications" overlay now shows exactly WHAT
-- matched for each flagged lead. The reason was never stored
-- (possible_duplicate_ids is just a uuid[]), so derive it pairwise here
-- using the same signals find_similar_leads matches on:
--   * same bid/reference number      -> detail = the bid number
--   * a shared document (name+size)  -> detail = the file name(s)
--   * same title ignoring spacing/punctuation -> detail = the title
--   * >= 50% title-word overlap      -> detail = the shared words
-- Comparing the two leads directly (rather than storing the reason at save
-- time) keeps it symmetric for back-linked leads and correct for leads
-- flagged before this change. Every matching signal is listed.
--
-- The detail values come from the CURRENT lead (which the caller can
-- already view) — they're equal on both sides by definition, so nothing
-- about a lead the viewer can't open is revealed beyond "this matched".
--
-- match_reasons is a jsonb array of {type, label, detail}. Return type
-- changes, so the function must be dropped first.

drop function if exists public.get_lead_duplicate_refs(uuid);

create function public.get_lead_duplicate_refs(p_lead_id uuid)
returns table (id uuid, lead_number text, team text, title text, can_view boolean, match_reasons jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.lead_number, d.team,
         case when public.can_view_lead(d.id) then d.title end,
         public.can_view_lead(d.id),
         coalesce(jsonb_agg(r.reason order by r.ord) filter (where r.reason is not null), '[]'::jsonb)
  from public.leads src
  join public.leads d on d.id = any (src.possible_duplicate_ids)
  cross join lateral (
    -- 1. bid number
    select 1 as ord,
           case when nullif(trim(src.bid_number), '') is not null
                 and lower(trim(src.bid_number)) = lower(trim(coalesce(d.bid_number, '')))
                then jsonb_build_object('type', 'bid', 'label', 'Same bid / reference number', 'detail', trim(src.bid_number))
           end as reason
    union all
    -- 2. shared document(s)
    select 2,
           (select jsonb_build_object('type', 'document', 'label',
                     case when count(distinct a->>'name') > 1 then 'Same documents uploaded' else 'Same document uploaded' end,
                     'detail', string_agg(distinct a->>'name', '; '))
            from jsonb_array_elements(coalesce(src.documents, '[]'::jsonb)) a
            join jsonb_array_elements(coalesce(d.documents, '[]'::jsonb)) b
              on a->>'name' = b->>'name' and a->>'size' = b->>'size'
            where a->>'name' is not null
            having count(*) > 0)
    union all
    -- 3. title: exact (ignoring spacing/punctuation) or >= 50% word overlap
    select 3,
           case
             when nullif(public.afc_collapsed_lead_text(src.title), '') is not null
                  and public.afc_collapsed_lead_text(src.title) = public.afc_collapsed_lead_text(d.title)
               then jsonb_build_object('type', 'title', 'label', 'Identical title', 'detail', src.title)
             when coalesce((
                    select count(*)::numeric
                    from unnest(public.afc_lead_tokens(d.title)) t
                    where t = any (public.afc_lead_tokens(src.title))
                  ) / nullif(greatest(
                    array_length(public.afc_lead_tokens(d.title), 1),
                    array_length(public.afc_lead_tokens(src.title), 1)
                  ), 0), 0) >= 0.5
               then jsonb_build_object('type', 'title', 'label', 'Similar title', 'detail',
                      'Common words: ' || (
                        select string_agg(distinct t, ', ')
                        from unnest(public.afc_lead_tokens(src.title)) t
                        where t = any (public.afc_lead_tokens(d.title))
                      ))
           end
  ) r
  where src.id = p_lead_id
    and public.can_view_lead(p_lead_id)
  group by d.id, d.lead_number, d.team, d.title, d.created_at
  order by d.created_at;
$$;

revoke all on function public.get_lead_duplicate_refs(uuid) from public;
grant execute on function public.get_lead_duplicate_refs(uuid) to authenticated;
