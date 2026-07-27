-- Knowledge Repository: a searchable, org-wide project-experience database
-- (ported from an earlier, separate application — see
-- old/src/modules/afc/KnowledgeRepository.jsx for the reference UI/behavior
-- this schema supports). Unlike Empanelment, this is intentionally NOT
-- team-scoped for reads: any staff member (not a Business Associate) can
-- search/view every project, so past experience can be cited in proposals
-- company-wide. Writes go through ordinary RLS-gated INSERT/UPDATE/DELETE
-- (not service-role edge functions) since nothing here is a privileged
-- decision the way an empanelment stage transition is.

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  shortform   text,
  client      text,
  location    text,
  team        text,
  -- Free-form project detail (contract value, dates, contact, staff-months,
  -- descriptions, etc.) — kept as one jsonb blob rather than one column per
  -- field, matching the old project's shape 1:1 so the export builder and
  -- form logic can be ported over unchanged.
  summary     jsonb not null default '{}',
  created_by  uuid references public.afc_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index projects_team_idx       on public.projects(team);
create index projects_created_by_idx on public.projects(created_by);

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create table public.keywords (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table public.project_keyword_details (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  keyword_id  uuid not null references public.keywords(id) on delete cascade,
  description text,
  created_at  timestamptz not null default now(),
  unique (project_id, keyword_id)
);

create index project_keyword_details_project_idx on public.project_keyword_details(project_id);
create index project_keyword_details_keyword_idx on public.project_keyword_details(keyword_id);

-- Private bucket — rows store only the storage path, never a public URL
-- (same convention as ba-documents), even though this module's visibility
-- is org-wide rather than narrowly scoped to one application.
create table public.project_documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  file_name    text not null,
  storage_path text not null,
  uploaded_by  uuid references public.afc_users(id),
  created_at   timestamptz not null default now()
);

create index project_documents_project_idx on public.project_documents(project_id);

create table public.shortlists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references public.afc_users(id),
  team       text,
  created_at timestamptz not null default now()
);

create table public.shortlist_projects (
  id                uuid primary key default gen_random_uuid(),
  shortlist_id      uuid not null references public.shortlists(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  selected_kw_names jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  unique (shortlist_id, project_id)
);

create index shortlist_projects_shortlist_idx on public.shortlist_projects(shortlist_id);
create index shortlist_projects_project_idx   on public.shortlist_projects(project_id);

-- ── Permissions ─────────────────────────────────────────────────
-- Edit/delete a project: the person who added it, MD, or the project's own
-- team's DGM — exactly the old project's rule, unchanged.
create or replace function public.can_edit_project(p_created_by uuid, p_team text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    auth.uid() = p_created_by
    or public.current_afc_role() = 'md'
    or (public.current_afc_role() = 'dgm' and p_team = public.current_afc_team());
$$;

alter table public.projects                 enable row level security;
alter table public.keywords                 enable row level security;
alter table public.project_keyword_details  enable row level security;
alter table public.project_documents        enable row level security;
alter table public.shortlists               enable row level security;
alter table public.shortlist_projects       enable row level security;

-- projects — org-wide read for every staff role; any staff can add one;
-- edit/delete follows can_edit_project.
create policy projects_select on public.projects
for select using (public.current_afc_role() != 'business_associate');

create policy projects_insert on public.projects
for insert with check (public.current_afc_role() != 'business_associate' and created_by = auth.uid());

create policy projects_update on public.projects
for update using (public.can_edit_project(created_by, team));

create policy projects_delete on public.projects
for delete using (public.can_edit_project(created_by, team));

-- keywords — shared vocabulary. Any staff can read or add a new one (needed
-- inline while tagging a project). No update/delete from the client:
-- renaming or removing a keyword would silently affect every project
-- already tagged with it.
create policy keywords_select on public.keywords
for select using (public.current_afc_role() != 'business_associate');

create policy keywords_insert on public.keywords
for insert with check (public.current_afc_role() != 'business_associate');

-- project_keyword_details — follows the parent project's permissions.
create policy project_keyword_details_select on public.project_keyword_details
for select using (
  exists (select 1 from public.projects p where p.id = project_id and public.current_afc_role() != 'business_associate')
);
create policy project_keyword_details_insert on public.project_keyword_details
for insert with check (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);
create policy project_keyword_details_update on public.project_keyword_details
for update using (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);
create policy project_keyword_details_delete on public.project_keyword_details
for delete using (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);

-- project_documents — same, follows the parent project's permissions.
create policy project_documents_select on public.project_documents
for select using (
  exists (select 1 from public.projects p where p.id = project_id and public.current_afc_role() != 'business_associate')
);
create policy project_documents_insert on public.project_documents
for insert with check (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);
create policy project_documents_delete on public.project_documents
for delete using (
  exists (select 1 from public.projects p where p.id = project_id and public.can_edit_project(p.created_by, p.team))
);

-- shortlists — a personal/team organizing tool: only the creator (or MD)
-- manages a shortlist, but any staff member can browse any shortlist,
-- matching the old project's behavior of listing every shortlist, not just
-- the caller's own.
create policy shortlists_select on public.shortlists
for select using (public.current_afc_role() != 'business_associate');

create policy shortlists_insert on public.shortlists
for insert with check (public.current_afc_role() != 'business_associate' and created_by = auth.uid());

create policy shortlists_update on public.shortlists
for update using (created_by = auth.uid() or public.current_afc_role() = 'md');

create policy shortlists_delete on public.shortlists
for delete using (created_by = auth.uid() or public.current_afc_role() = 'md');

-- shortlist_projects — follows the parent shortlist's permissions.
create policy shortlist_projects_select on public.shortlist_projects
for select using (
  exists (select 1 from public.shortlists s where s.id = shortlist_id and public.current_afc_role() != 'business_associate')
);
create policy shortlist_projects_insert on public.shortlist_projects
for insert with check (
  exists (select 1 from public.shortlists s where s.id = shortlist_id and (s.created_by = auth.uid() or public.current_afc_role() = 'md'))
);
create policy shortlist_projects_update on public.shortlist_projects
for update using (
  exists (select 1 from public.shortlists s where s.id = shortlist_id and (s.created_by = auth.uid() or public.current_afc_role() = 'md'))
);
create policy shortlist_projects_delete on public.shortlist_projects
for delete using (
  exists (select 1 from public.shortlists s where s.id = shortlist_id and (s.created_by = auth.uid() or public.current_afc_role() = 'md'))
);

-- ── Storage ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-documents', 'project-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

-- Object path convention: {project_id}/{timestamp}_{safe filename} — lets
-- these policies derive the owning project straight from the path instead
-- of needing a join through project_documents.
create policy project_documents_storage_select on storage.objects
for select using (
  bucket_id = 'project-documents'
  and public.current_afc_role() != 'business_associate'
);

create policy project_documents_storage_insert on storage.objects
for insert with check (
  bucket_id = 'project-documents'
  and exists (
    select 1 from public.projects p
    where p.id = (split_part(name, '/', 1))::uuid
      and public.can_edit_project(p.created_by, p.team)
  )
);

create policy project_documents_storage_delete on storage.objects
for delete using (
  bucket_id = 'project-documents'
  and exists (
    select 1 from public.projects p
    where p.id = (split_part(name, '/', 1))::uuid
      and public.can_edit_project(p.created_by, p.team)
  )
);
