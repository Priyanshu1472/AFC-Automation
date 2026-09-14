-- Company Documents — organization-wide documents (policies, SOPs,
-- guidelines, etc.) inside the Knowledge Repository, kept completely
-- separate from project_documents (which belong to individual projects).
-- Same architecture as project_documents: one table + one private storage
-- bucket, RLS-gated, no edge function (writes go straight through
-- supabase-js from the client, exactly like DocumentUpload in
-- KnowledgeFormParts.jsx does for projects) — RLS is what actually
-- enforces admin-only writes, not the UI.
--
-- Visibility mirrors the rest of the Knowledge Repository
-- (KNOWLEDGE_REPOSITORY_ROLES / current_afc_role() != 'business_associate'
-- everywhere else in this module — projects, keywords, project_documents).
-- Only 'admin' may insert/update/delete, enforced here in RLS so a direct
-- API call from any other role is rejected regardless of the UI.

create table if not exists public.company_documents (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  doc_type     text not null default 'Other',
  file_name    text not null,
  file_size    bigint,
  mime_type    text,
  storage_path text not null,
  uploaded_by  uuid references public.afc_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists company_documents_created_at_idx on public.company_documents(created_at desc);

drop trigger if exists company_documents_set_updated_at on public.company_documents;
create trigger company_documents_set_updated_at
before update on public.company_documents
for each row execute function public.set_updated_at();

alter table public.company_documents enable row level security;

drop policy if exists company_documents_select on public.company_documents;
create policy company_documents_select on public.company_documents
for select using (public.current_afc_role() != 'business_associate');

-- uploaded_by = auth.uid() is enforced here (not left to the client) so a
-- crafted insert can't attribute a document to a different user.
drop policy if exists company_documents_insert on public.company_documents;
create policy company_documents_insert on public.company_documents
for insert with check (
  public.current_afc_role() = 'admin'
  and uploaded_by = auth.uid()
);

drop policy if exists company_documents_update on public.company_documents;
create policy company_documents_update on public.company_documents
for update using (public.current_afc_role() = 'admin')
with check (public.current_afc_role() = 'admin');

drop policy if exists company_documents_delete on public.company_documents;
create policy company_documents_delete on public.company_documents
for delete using (public.current_afc_role() = 'admin');

-- ── Storage ─────────────────────────────────────────────────────
-- Its own bucket (not project-documents) so "company documents must never
-- appear in a project repository, and vice versa" is a structural
-- guarantee, not just a query filter — same storage mechanism/pattern as
-- project-documents, just a separate namespace.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-documents', 'company-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

drop policy if exists company_documents_storage_select on storage.objects;
create policy company_documents_storage_select on storage.objects
for select using (
  bucket_id = 'company-documents'
  and public.current_afc_role() != 'business_associate'
);

drop policy if exists company_documents_storage_insert on storage.objects;
create policy company_documents_storage_insert on storage.objects
for insert with check (
  bucket_id = 'company-documents'
  and public.current_afc_role() = 'admin'
);

drop policy if exists company_documents_storage_delete on storage.objects;
create policy company_documents_storage_delete on storage.objects
for delete using (
  bucket_id = 'company-documents'
  and public.current_afc_role() = 'admin'
);
