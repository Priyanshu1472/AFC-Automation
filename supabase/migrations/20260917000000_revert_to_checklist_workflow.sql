-- Revert the "Document Assembly Workspace v2" (unified documents table +
-- assembly ordering + PDF build) back to the original three-panel
-- checklist workflow: BP document requests, the AFC internal checklist,
-- and the three fixed Proposal Documents slots. No merge/build feature
-- this time — the user wants this purely as a place to collect and store
-- proposal documents, not to assemble a final proposal here.
--
-- Irreversible: at the time of writing this dropped 8 rows from
-- proposal_documents, 3 from proposal_document_versions, 1 from
-- proposal_assembly_items, and 3 from proposal_builds. Storage objects in
-- the proposal-documents bucket are untouched (a table drop doesn't touch
-- Storage) — they're simply orphaned, which is harmless.

drop table if exists public.proposal_document_versions cascade;
drop table if exists public.proposal_assembly_items cascade;
drop table if exists public.proposal_builds cascade;
drop table if exists public.proposal_documents cascade;

-- ── proposal_document_requests (BP document requests) ───────────────────
create table public.proposal_document_requests (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.proposal_preparations(id) on delete cascade,
  item_name       text not null,
  justification   text,
  sent_at         timestamptz,
  file_name       text,
  file_path       text,
  file_size       bigint,
  uploaded_at     timestamptz,
  uploaded_by     uuid references public.afc_users(id),
  created_by      uuid references public.afc_users(id),
  created_at      timestamptz not null default now()
);
create index proposal_document_requests_proposal_idx on public.proposal_document_requests(proposal_id);

-- ── proposal_afc_checklist_items (AFC internal checklist) ───────────────
create table public.proposal_afc_checklist_items (
  id                          uuid primary key default gen_random_uuid(),
  proposal_id                 uuid not null references public.proposal_preparations(id) on delete cascade,
  item_name                   text not null,
  notes                       text,
  status                      text,
  file_name                   text,
  file_path                   text,
  file_size                   bigint,
  uploaded_at                 timestamptz,
  uploaded_by                 uuid references public.afc_users(id),
  source                      text check (source in ('upload', 'knowledge_repository')),
  source_project_document_id  uuid references public.project_documents(id) on delete set null,
  created_by                  uuid references public.afc_users(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index proposal_afc_checklist_items_proposal_idx on public.proposal_afc_checklist_items(proposal_id);

-- ── proposal_documents (Technical / Financial / Proposal 3 slots) ───────
create table public.proposal_documents (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposal_preparations(id) on delete cascade,
  doc_type     text not null check (doc_type in ('technical', 'financial', 'proposal_3')),
  file_name    text,
  file_path    text,
  file_size    bigint,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (proposal_id, doc_type)
);
create index proposal_documents_proposal_idx on public.proposal_documents(proposal_id);

alter table public.proposal_document_requests enable row level security;
alter table public.proposal_afc_checklist_items enable row level security;
alter table public.proposal_documents enable row level security;

-- Same shape on all three: select via can_view_proposal, full CRUD via
-- can_edit_proposal (role + not-locked) — plain direct-RLS writes, nothing
-- routed through an edge function except sending the BP request email.
create policy proposal_document_requests_select on public.proposal_document_requests
for select using (public.can_view_proposal(proposal_id));
create policy proposal_document_requests_insert on public.proposal_document_requests
for insert with check (public.can_edit_proposal(proposal_id));
create policy proposal_document_requests_update on public.proposal_document_requests
for update using (public.can_edit_proposal(proposal_id));
create policy proposal_document_requests_delete on public.proposal_document_requests
for delete using (public.can_edit_proposal(proposal_id));

create policy proposal_afc_checklist_items_select on public.proposal_afc_checklist_items
for select using (public.can_view_proposal(proposal_id));
create policy proposal_afc_checklist_items_insert on public.proposal_afc_checklist_items
for insert with check (public.can_edit_proposal(proposal_id));
create policy proposal_afc_checklist_items_update on public.proposal_afc_checklist_items
for update using (public.can_edit_proposal(proposal_id));
create policy proposal_afc_checklist_items_delete on public.proposal_afc_checklist_items
for delete using (public.can_edit_proposal(proposal_id));

create policy proposal_documents_select on public.proposal_documents
for select using (public.can_view_proposal(proposal_id));
create policy proposal_documents_insert on public.proposal_documents
for insert with check (public.can_edit_proposal(proposal_id));
create policy proposal_documents_update on public.proposal_documents
for update using (public.can_edit_proposal(proposal_id));
create policy proposal_documents_delete on public.proposal_documents
for delete using (public.can_edit_proposal(proposal_id));
