-- Fix two real scoring bugs found while live-testing find_relevant_experience()
-- against real projects:
--
-- 1. Keyword-name matching used pg_trgm's similarity(), which compares
--    the UNION of trigrams between two strings — a 3-letter keyword name
--    ("GIS") against a 90-character natural-language query gets almost no
--    overlap purely because of the length mismatch (similarity() penalizes
--    that heavily), so a keyword essentially never crossed the 0.2
--    threshold even when it appeared verbatim in the query. pg_trgm's
--    word_similarity() is built for exactly this "does this short word
--    appear somewhere in this longer text" comparison and doesn't have
--    that penalty — used here for keyword-name matching and (for
--    consistency/robustness against query length) title/client matching.
--
-- 2. services_score/keyword_score used ts_rank_cd() directly. Since our
--    generated tsvector columns have no setweight() labels (everything is
--    the lowest default weight), ts_rank_cd's raw output lands in a tiny
--    range (~0.005-0.02) no matter how well the text actually matches —
--    nowhere near comparable to semantic_score's typical 0.3-0.8 cosine
--    similarity range, so SERVICES_WEIGHT/KEYWORD_WEIGHT were contributing
--    almost nothing regardless of how good the lexical match was. Replaced
--    with a plain, explainable word-overlap ratio: the fraction of the
--    query's distinct significant words that also appear in that field —
--    naturally bounded 0..1 and comparable in scale to the other
--    components.
create or replace function public.find_relevant_experience(
  p_query_embedding extensions.vector(384) default null,
  p_query_text text default null,
  p_search_services boolean default true,
  p_search_keywords boolean default true,
  p_locations text[] default null,
  p_countries text[] default null,
  p_client_types text[] default null,
  p_statuses text[] default null,
  p_keyword_names text[] default null,
  p_year_min int default null,
  p_year_max int default null,
  p_value_min numeric default null,
  p_value_max numeric default null,
  p_match_count int default 100
)
returns table (
  project_id uuid,
  semantic_score float,
  services_score float,
  keyword_score float,
  metadata_score float,
  matched_keywords jsonb
)
language sql
stable
set search_path = public, extensions
as $$
  with query_words as (
    select coalesce(array_agg(distinct lexeme), '{}'::text[]) as words
    from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query_text, '')))) as lexeme
  ),
  qw as (
    select words, greatest(array_length(words, 1), 0) as n from query_words
  ),
  semantic_candidates as (
    select e.project_id, 1 - (e.embedding <=> p_query_embedding) as score
    from public.project_experience_embeddings e
    where p_query_embedding is not null and e.embedding is not null
    order by e.embedding <=> p_query_embedding
    limit p_match_count
  ),
  services_overlap as (
    select e.project_id,
      case when qw.n = 0 then 0 else
        (select count(*) from unnest(qw.words) w where e.services_tsv @@ to_tsquery('english', w))::float / qw.n
      end as score
    from public.project_experience_embeddings e, qw
    where p_search_services
  ),
  services_candidates as (
    select project_id, score from services_overlap where score > 0
    order by score desc limit p_match_count
  ),
  keywords_overlap as (
    select e.project_id,
      case when qw.n = 0 then 0 else
        (select count(*) from unnest(qw.words) w where e.keywords_tsv @@ to_tsquery('english', w))::float / qw.n
      end as score
    from public.project_experience_embeddings e, qw
    where p_search_keywords
  ),
  keyword_text_candidates as (
    select project_id, score from keywords_overlap where score > 0
    order by score desc limit p_match_count
  ),
  keyword_name_candidates as (
    select pkd.project_id, max(word_similarity(k.name, p_query_text)) as score
    from public.project_keyword_details pkd
    join public.keywords k on k.id = pkd.keyword_id
    where p_search_keywords and p_query_text is not null and word_similarity(k.name, p_query_text) > 0.3
    group by pkd.project_id
    limit p_match_count
  ),
  metadata_candidates as (
    select p.id as project_id,
      greatest(word_similarity(coalesce(p.title,''), p_query_text), word_similarity(coalesce(p.client,''), p_query_text)) as score
    from public.projects p
    where p_query_text is not null
      and (word_similarity(coalesce(p.title,''), p_query_text) > 0.3 or word_similarity(coalesce(p.client,''), p_query_text) > 0.3)
    order by score desc
    limit p_match_count
  ),
  candidate_ids as (
    select project_id from semantic_candidates
    union select project_id from services_candidates
    union select project_id from keyword_text_candidates
    union select project_id from keyword_name_candidates
    union select project_id from metadata_candidates
  ),
  matched_kw as (
    select pkd.project_id,
      jsonb_agg(jsonb_build_object('name', k.name, 'description', pkd.description)) as keywords
    from public.project_keyword_details pkd
    join public.keywords k on k.id = pkd.keyword_id
    where pkd.project_id in (select project_id from candidate_ids)
      and (
        (p_keyword_names is not null and k.name = any(p_keyword_names))
        or (p_query_text is not null and (word_similarity(k.name, p_query_text) > 0.3 or k.name ilike '%' || p_query_text || '%'))
      )
    group by pkd.project_id
  )
  select
    c.project_id,
    coalesce(sc.score, 0)::float as semantic_score,
    coalesce(sv.score, 0)::float as services_score,
    greatest(coalesce(kt.score, 0), coalesce(kn.score, 0))::float as keyword_score,
    coalesce(md.score, 0)::float as metadata_score,
    coalesce(mk.keywords, '[]'::jsonb) as matched_keywords
  from candidate_ids c
  join public.projects p on p.id = c.project_id
  left join semantic_candidates sc on sc.project_id = c.project_id
  left join services_candidates sv on sv.project_id = c.project_id
  left join keyword_text_candidates kt on kt.project_id = c.project_id
  left join keyword_name_candidates kn on kn.project_id = c.project_id
  left join metadata_candidates md on md.project_id = c.project_id
  left join matched_kw mk on mk.project_id = c.project_id
  where public.current_afc_role() != 'business_associate'
    and (p_locations is null or p.location = any(p_locations))
    and (p_countries is null or (p.summary ->> 'country') = any(p_countries))
    and (p_client_types is null or p.client_type = any(p_client_types))
    and (p_statuses is null or p.status = any(p_statuses))
    and (p_year_min is null or substring(p.summary ->> 'startDate' from '^(\d{4})')::int >= p_year_min)
    and (p_year_max is null or substring(p.summary ->> 'startDate' from '^(\d{4})')::int <= p_year_max)
    and (p_value_min is null or nullif(p.summary ->> 'capitalCost', '')::numeric >= p_value_min)
    and (p_value_max is null or nullif(p.summary ->> 'capitalCost', '')::numeric <= p_value_max)
    and (p_keyword_names is null or exists (
      select 1 from public.project_keyword_details pkd2
      join public.keywords k2 on k2.id = pkd2.keyword_id
      where pkd2.project_id = p.id and k2.name = any(p_keyword_names)
    ));
$$;
