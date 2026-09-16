-- "Find Relevant Experience" — hybrid semantic + full-text search over the
-- Knowledge Repository, so staff can find past projects by describing the
-- kind of experience they need instead of knowing the project name.
--
-- Adds:
--   - vector + pg_trgm extensions (neither existed anywhere in this repo)
--   - project_experience_embeddings: one row per project holding the
--     canonical searchable text (combined + split by content type so
--     Actual Services / Keywords can be scored independently of the
--     overall semantic embedding) plus its vector embedding.
--   - find_relevant_experience(): a single RPC that merges vector search,
--     full-text search (services/keywords) and trigram search (keyword
--     names, project title/client — so an exact known-project search still
--     works in this mode) into one candidate set with per-component raw
--     scores. Final weighting into one relevance number happens in the
--     frontend (src/lib/experienceSearchConfig.js) so weights are tunable
--     without a migration.
--
-- RLS on the new table mirrors project_keyword_details exactly (same
-- can_edit_project() write gate, same non-business_associate read gate) —
-- deliberately NOT broadened. The Knowledge Repository is empty today;
-- projects added going forward are indexed automatically by whoever
-- saves them (see useProjectIndexing.js), which already satisfies
-- can_edit_project for that project. See the plan doc for why a bulk
-- historical-import scenario would need revisiting this later.
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table public.project_experience_embeddings (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null unique references public.projects(id) on delete cascade,
  content         text not null,
  services_text   text,
  keywords_text   text,
  content_hash    text not null,
  embedding       extensions.vector(384),
  embedding_model text not null default 'Xenova/all-MiniLM-L6-v2',
  embedding_version int not null default 1,
  indexed_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists project_experience_embeddings_set_updated_at on public.project_experience_embeddings;
create trigger project_experience_embeddings_set_updated_at
before update on public.project_experience_embeddings
for each row execute function public.set_updated_at();

alter table public.project_experience_embeddings
  add column services_tsv tsvector generated always as (to_tsvector('english', coalesce(services_text, ''))) stored,
  add column keywords_tsv tsvector generated always as (to_tsvector('english', coalesce(keywords_text, ''))) stored;

create index project_experience_embeddings_services_tsv_idx on public.project_experience_embeddings using gin (services_tsv);
create index project_experience_embeddings_keywords_tsv_idx on public.project_experience_embeddings using gin (keywords_tsv);
create index project_experience_embeddings_embedding_idx on public.project_experience_embeddings using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100);

-- Trigram indexes for the "exact known project name still works in this
-- search mode" candidate source, and for fuzzy keyword-name matching.
create index projects_title_trgm_idx on public.projects using gin (title extensions.gin_trgm_ops);
create index projects_client_trgm_idx on public.projects using gin (client extensions.gin_trgm_ops);
create index keywords_name_trgm_idx on public.keywords using gin (name extensions.gin_trgm_ops);

alter table public.project_experience_embeddings enable row level security;

create policy project_experience_embeddings_select on public.project_experience_embeddings
for select using (
  exists (select 1 from public.projects p where p.id = project_id and public.current_afc_role() != 'business_associate')
);

create policy project_experience_embeddings_insert on public.project_experience_embeddings
for insert with check (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);

create policy project_experience_embeddings_update on public.project_experience_embeddings
for update using (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);

-- ── find_relevant_experience() ──────────────────────────────────────────
-- security invoker (the default) — governed entirely by the RLS above and
-- on `projects`/`keywords`, never bypasses it. Returns raw, unweighted
-- 0..1 component scores per candidate project; the frontend applies
-- SEMANTIC_WEIGHT/SERVICES_WEIGHT/KEYWORD_WEIGHT/METADATA_WEIGHT.
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
  with tsq as (
    select case when p_query_text is not null and length(trim(p_query_text)) > 0
      then websearch_to_tsquery('english', p_query_text) else null end as q
  ),
  semantic_candidates as (
    select e.project_id, 1 - (e.embedding <=> p_query_embedding) as score
    from public.project_experience_embeddings e
    where p_query_embedding is not null and e.embedding is not null
    order by e.embedding <=> p_query_embedding
    limit p_match_count
  ),
  services_candidates as (
    select e.project_id, ts_rank_cd(e.services_tsv, tsq.q, 32) as score
    from public.project_experience_embeddings e, tsq
    where p_search_services and tsq.q is not null and e.services_tsv @@ tsq.q
    order by score desc
    limit p_match_count
  ),
  keyword_text_candidates as (
    select e.project_id, ts_rank_cd(e.keywords_tsv, tsq.q, 32) as score
    from public.project_experience_embeddings e, tsq
    where p_search_keywords and tsq.q is not null and e.keywords_tsv @@ tsq.q
    order by score desc
    limit p_match_count
  ),
  keyword_name_candidates as (
    select pkd.project_id, max(similarity(k.name, p_query_text)) as score
    from public.project_keyword_details pkd
    join public.keywords k on k.id = pkd.keyword_id
    where p_search_keywords and p_query_text is not null and similarity(k.name, p_query_text) > 0.2
    group by pkd.project_id
    limit p_match_count
  ),
  metadata_candidates as (
    select p.id as project_id,
      greatest(similarity(coalesce(p.title,''), p_query_text), similarity(coalesce(p.client,''), p_query_text)) as score
    from public.projects p
    where p_query_text is not null
      and (similarity(coalesce(p.title,''), p_query_text) > 0.2 or similarity(coalesce(p.client,''), p_query_text) > 0.2)
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
        or (p_query_text is not null and (similarity(k.name, p_query_text) > 0.2 or k.name ilike '%' || p_query_text || '%'))
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
