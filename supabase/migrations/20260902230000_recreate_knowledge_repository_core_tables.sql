-- RECOVERY migration — the Knowledge Repository's core tables (projects,
-- keywords, project_keyword_details, project_documents) do not exist on
-- the live afc-automation-dev database at all, despite
-- 20260722020000_knowledge_repository.sql being recorded as "applied" in
-- both local and remote migration history. Discovered while building the
-- Proposal Preparation merge feature, which needs to reference
-- project_documents(id) from a new column.
--
-- Verified before writing this (via `supabase db query --linked`):
--   - None of the 4 tables exist anywhere (checked pg_tables, not just
--     information_schema, to rule out a schema/visibility fluke).
--   - shortlist_projects.project_id still exists as a plain uuid column
--     but its FK to projects(id) is gone — consistent with someone having
--     run `drop table projects cascade` at some point (cascade drops
--     dependent FKs but not the referencing column/table itself).
--   - shortlists (0 rows) and shortlist_projects (0 rows) are both
--     completely empty, and the project-documents storage bucket has 0
--     objects in it — so this is NOT a data-loss incident, nothing was
--     ever actually stored through this feature. It was never fully live.
--   - can_edit_project() and set_updated_at() (both needed below) already
--     exist — only the tables/indexes/trigger/RLS/some storage policies
--     are missing.
--   - The project-documents bucket itself already exists, as does its
--     SELECT storage policy; only the INSERT/DELETE storage policies
--     (which reference the now-recreated `projects` table) are missing.
--
-- This recreates exactly what 20260722020000 originally defined for these
-- 4 tables, using IF NOT EXISTS / DROP...IF EXISTS guards throughout so
-- it's safe to run even if some piece partially survived.

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  shortform   text,
  client      text,
  location    text,
  team        text,
  summary     jsonb not null default '{}',
  created_by  uuid references public.afc_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_team_idx       on public.projects(team);
create index if not exists projects_created_by_idx on public.projects(created_by);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create table if not exists public.keywords (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.project_keyword_details (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  keyword_id  uuid not null references public.keywords(id) on delete cascade,
  description text,
  created_at  timestamptz not null default now(),
  unique (project_id, keyword_id)
);

create index if not exists project_keyword_details_project_idx on public.project_keyword_details(project_id);
create index if not exists project_keyword_details_keyword_idx on public.project_keyword_details(keyword_id);

create table if not exists public.project_documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  file_name    text not null,
  storage_path text not null,
  uploaded_by  uuid references public.afc_users(id),
  created_at   timestamptz not null default now()
);

create index if not exists project_documents_project_idx on public.project_documents(project_id);

-- ── Restore the FK that shortlist_projects lost when `projects` was
-- dropped (add only if it's genuinely missing). ────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shortlist_projects'::regclass
      and conname = 'shortlist_projects_project_id_fkey'
  ) then
    alter table public.shortlist_projects
      add constraint shortlist_projects_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete cascade;
  end if;
end $$;

-- ── Permissions ─────────────────────────────────────────────────
alter table public.projects                 enable row level security;
alter table public.keywords                 enable row level security;
alter table public.project_keyword_details  enable row level security;
alter table public.project_documents        enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
for select using (public.current_afc_role() != 'business_associate');

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
for insert with check (public.current_afc_role() != 'business_associate' and created_by = auth.uid());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
for update using (public.can_edit_project(created_by, team));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
for delete using (public.can_edit_project(created_by, team));

drop policy if exists keywords_select on public.keywords;
create policy keywords_select on public.keywords
for select using (public.current_afc_role() != 'business_associate');

drop policy if exists keywords_insert on public.keywords;
create policy keywords_insert on public.keywords
for insert with check (public.current_afc_role() != 'business_associate');

drop policy if exists project_keyword_details_select on public.project_keyword_details;
create policy project_keyword_details_select on public.project_keyword_details
for select using (
  exists (select 1 from public.projects p where p.id = project_id and public.current_afc_role() != 'business_associate')
);
drop policy if exists project_keyword_details_insert on public.project_keyword_details;
create policy project_keyword_details_insert on public.project_keyword_details
for insert with check (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);
drop policy if exists project_keyword_details_update on public.project_keyword_details;
create policy project_keyword_details_update on public.project_keyword_details
for update using (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);
drop policy if exists project_keyword_details_delete on public.project_keyword_details;
create policy project_keyword_details_delete on public.project_keyword_details
for delete using (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);

drop policy if exists project_documents_select on public.project_documents;
create policy project_documents_select on public.project_documents
for select using (
  exists (select 1 from public.projects p where p.id = project_id and public.current_afc_role() != 'business_associate')
);
drop policy if exists project_documents_insert on public.project_documents;
create policy project_documents_insert on public.project_documents
for insert with check (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);
drop policy if exists project_documents_delete on public.project_documents;
create policy project_documents_delete on public.project_documents
for delete using (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);

-- ── Storage ─────────────────────────────────────────────────────
-- Bucket + its SELECT policy already exist live; only INSERT/DELETE were
-- missing (both reference `projects`, which didn't exist until now).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-documents', 'project-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

drop policy if exists project_documents_storage_select on storage.objects;
create policy project_documents_storage_select on storage.objects
for select using (
  bucket_id = 'project-documents'
  and public.current_afc_role() != 'business_associate'
);

drop policy if exists project_documents_storage_insert on storage.objects;
create policy project_documents_storage_insert on storage.objects
for insert with check (
  bucket_id = 'project-documents'
  and exists (
    select 1 from public.projects p
    where p.id = (split_part(name, '/', 1))::uuid
      and public.can_edit_project(p.created_by, p.team)
  )
);

drop policy if exists project_documents_storage_delete on storage.objects;
create policy project_documents_storage_delete on storage.objects
for delete using (
  bucket_id = 'project-documents'
  and exists (
    select 1 from public.projects p
    where p.id = (split_part(name, '/', 1))::uuid
      and public.can_edit_project(p.created_by, p.team)
  )
);
