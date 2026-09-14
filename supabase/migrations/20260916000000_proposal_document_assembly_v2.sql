-- Proposal Preparation — Document Assembly Workspace v2. Replaces the
-- deleted cluster (20260915000000) with a simpler shape: one generic
-- document table (AFC / BA / Client / Supporting, tagged by `category`)
-- instead of three parallel ones, real append-only version history, an
-- ordered assembly list, and a build-history log with a pinned manifest.
--
-- Final assembly is real PDF-page concatenation (pdf-lib, client-side) —
-- never DOCX XML-splicing. A non-PDF version can carry a companion
-- `pdf_file_*` (the "approved PDF" fallback) alongside the original source
-- file, which is never touched/replaced.

create table public.proposal_documents (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null references public.proposal_preparations(id) on delete cascade,
  title             text not null,
  category          text not null check (category in ('afc', 'ba', 'client', 'supporting')),
  requirement_ref   text,
  description       text,
  review_status     text not null default 'pending'
                      check (review_status in ('pending', 'received', 'under_review', 'revision_required', 'approved')),
  review_remark     text,
  review_status_by  uuid references public.afc_users(id),
  review_status_at  timestamptz,
  created_by        uuid references public.afc_users(id),
  created_at        timestamptz not null default now()
);
create index proposal_documents_proposal_idx on public.proposal_documents(proposal_id);

create table public.proposal_document_versions (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.proposal_documents(id) on delete cascade,
  version_no      integer not null,
  file_name       text not null,
  file_path       text not null,
  file_size       bigint,
  file_ext        text not null,
  -- The "approved PDF" companion used for assembly when file_ext isn't
  -- already 'pdf'. Null until attached; assembly simply can't include this
  -- version until one of these two is present.
  pdf_file_name   text,
  pdf_file_path   text,
  pdf_file_size   bigint,
  uploaded_by     uuid references public.afc_users(id),
  uploaded_at     timestamptz not null default now()
);
create index proposal_document_versions_document_idx on public.proposal_document_versions(document_id, version_no);

create table public.proposal_assembly_items (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references public.proposal_preparations(id) on delete cascade,
  document_id   uuid not null references public.proposal_documents(id) on delete cascade,
  position      integer not null,
  created_at    timestamptz not null default now(),
  unique (proposal_id, document_id)
);
create index proposal_assembly_items_proposal_idx on public.proposal_assembly_items(proposal_id, position);

create table public.proposal_builds (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references public.proposal_preparations(id) on delete cascade,
  file_name     text not null,
  file_path     text not null,
  file_size     bigint,
  page_count    integer,
  -- Pinned [{document_id, title, category, version_no, file_path}] — this
  -- build stays reproducible even after documents are later revised.
  manifest      jsonb not null default '[]',
  created_by    uuid references public.afc_users(id),
  created_at    timestamptz not null default now()
);
create index proposal_builds_proposal_idx on public.proposal_builds(proposal_id, created_at desc);

alter table public.proposal_documents enable row level security;
alter table public.proposal_document_versions enable row level security;
alter table public.proposal_assembly_items enable row level security;
alter table public.proposal_builds enable row level security;

-- proposal_documents: full direct-RLS CRUD gated by can_edit_proposal, same
-- convention the old checklist/BP-request tables used.
create policy proposal_documents_select on public.proposal_documents
for select using (public.can_view_proposal(proposal_id));
create policy proposal_documents_insert on public.proposal_documents
for insert with check (public.can_edit_proposal(proposal_id));
create policy proposal_documents_update on public.proposal_documents
for update using (public.can_edit_proposal(proposal_id));
create policy proposal_documents_delete on public.proposal_documents
for delete using (public.can_edit_proposal(proposal_id));

-- proposal_document_versions: append-only, mirrors fee_note_events' shape
-- exactly (join back through the parent, no update/delete policy).
create policy proposal_document_versions_select on public.proposal_document_versions
for select using (exists (
  select 1 from public.proposal_documents d
  where d.id = proposal_document_versions.document_id and public.can_view_proposal(d.proposal_id)
));
create policy proposal_document_versions_insert on public.proposal_document_versions
for insert with check (exists (
  select 1 from public.proposal_documents d
  where d.id = proposal_document_versions.document_id and public.can_edit_proposal(d.proposal_id)
));

-- proposal_assembly_items: select/insert/delete direct (reordering deletes
-- + reinserts, or updates `position` in place) — add update too since drag
-- reordering is naturally an update of `position`, not a delete+reinsert.
create policy proposal_assembly_items_select on public.proposal_assembly_items
for select using (public.can_view_proposal(proposal_id));
create policy proposal_assembly_items_insert on public.proposal_assembly_items
for insert with check (public.can_edit_proposal(proposal_id));
create policy proposal_assembly_items_update on public.proposal_assembly_items
for update using (public.can_edit_proposal(proposal_id));
create policy proposal_assembly_items_delete on public.proposal_assembly_items
for delete using (public.can_edit_proposal(proposal_id));

-- proposal_builds: append-only build history, same shape as the old
-- proposal_merged_files.
create policy proposal_builds_select on public.proposal_builds
for select using (public.can_view_proposal(proposal_id));
create policy proposal_builds_insert on public.proposal_builds
for insert with check (public.can_edit_proposal(proposal_id));

-- Images are a valid "supporting" document format (scanned certificates
-- etc.) — the bucket only allowed pdf/doc/docx/xls/xlsx until now.
update storage.buckets
set allowed_mime_types = array_cat(allowed_mime_types, array['image/png', 'image/jpeg'])
where id = 'proposal-documents'
  and not (allowed_mime_types @> array['image/png']);
