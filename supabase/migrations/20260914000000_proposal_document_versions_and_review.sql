-- Proposal Preparation, Phase 1 (Document Management foundation):
--   1. document_origin — flags a checklist/request item as following a
--      client-provided RFP format, orthogonal to which table it lives in
--      (which already encodes "who's responsible" — AFC checklist vs BP
--      request). Not added to proposal_documents: those 3 slots are always
--      AFC's own final compiled output.
--   2. Append-only version history for all three "one current file" tables,
--      so replacing a file no longer destroys the superseded one. Mirrors
--      fee_note_events' exact shape (see 20260911100000_bid_payment_
--      requisition.sql:71-97) — insert-only, no update/delete policy,
--      access gated by joining back to the parent row's proposal_id.
--   3. review_status (+ remark/by/at) — current-state only, not a full
--      event log like fee notes: nothing asked for that here, and full
--      history is already covered by the version tables above.
--
-- Confirmed live before writing this (supabase db query --linked):
-- proposal-documents' storage INSERT policy is
--   bucket_id = 'proposal-documents' and current_afc_role() <> 'business_associate'
--   and can_edit_proposal((split_part(name,'/',1))::uuid)
-- so any new version row's file path, kept under the existing
-- `${proposalId}/...` prefix, is already covered — no storage policy change.

-- ── 1. document_origin ──────────────────────────────────────────────────
alter table public.proposal_document_requests
  add column document_origin text not null default 'own_format'
    check (document_origin in ('own_format', 'client_template'));

alter table public.proposal_afc_checklist_items
  add column document_origin text not null default 'own_format'
    check (document_origin in ('own_format', 'client_template'));

-- ── 2. Version history ──────────────────────────────────────────────────
create table public.proposal_document_request_versions (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.proposal_document_requests(id) on delete cascade,
  version_no    integer not null,
  file_name     text not null,
  file_path     text not null,
  file_size     bigint,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   uuid references public.afc_users(id)
);
create index proposal_document_request_versions_request_idx on public.proposal_document_request_versions(request_id, version_no);

create table public.proposal_afc_checklist_item_versions (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.proposal_afc_checklist_items(id) on delete cascade,
  version_no    integer not null,
  file_name     text not null,
  file_path     text not null,
  file_size     bigint,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   uuid references public.afc_users(id),
  -- Mirrors the parent's own source/source_project_document_id distinction
  -- (plain upload vs pulled from the Knowledge Repository).
  source        text check (source in ('upload', 'knowledge_repository')),
  source_project_document_id uuid references public.project_documents(id) on delete set null
);
create index proposal_afc_checklist_item_versions_item_idx on public.proposal_afc_checklist_item_versions(item_id, version_no);

create table public.proposal_documents_versions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.proposal_documents(id) on delete cascade,
  version_no    integer not null,
  file_name     text not null,
  file_path     text not null,
  file_size     bigint,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   uuid references public.afc_users(id)
);
create index proposal_documents_versions_document_idx on public.proposal_documents_versions(document_id, version_no);

alter table public.proposal_document_request_versions enable row level security;
alter table public.proposal_afc_checklist_item_versions enable row level security;
alter table public.proposal_documents_versions enable row level security;

-- Same shape for all three: select via can_view_proposal, insert via
-- can_edit_proposal, both joined back through the parent row — no update or
-- delete policy on any of them, append-only by construction.
create policy proposal_document_request_versions_select on public.proposal_document_request_versions
for select using (exists (
  select 1 from public.proposal_document_requests r
  where r.id = proposal_document_request_versions.request_id and public.can_view_proposal(r.proposal_id)
));
create policy proposal_document_request_versions_insert on public.proposal_document_request_versions
for insert with check (exists (
  select 1 from public.proposal_document_requests r
  where r.id = proposal_document_request_versions.request_id and public.can_edit_proposal(r.proposal_id)
));

create policy proposal_afc_checklist_item_versions_select on public.proposal_afc_checklist_item_versions
for select using (exists (
  select 1 from public.proposal_afc_checklist_items i
  where i.id = proposal_afc_checklist_item_versions.item_id and public.can_view_proposal(i.proposal_id)
));
create policy proposal_afc_checklist_item_versions_insert on public.proposal_afc_checklist_item_versions
for insert with check (exists (
  select 1 from public.proposal_afc_checklist_items i
  where i.id = proposal_afc_checklist_item_versions.item_id and public.can_edit_proposal(i.proposal_id)
));

create policy proposal_documents_versions_select on public.proposal_documents_versions
for select using (exists (
  select 1 from public.proposal_documents d
  where d.id = proposal_documents_versions.document_id and public.can_view_proposal(d.proposal_id)
));
create policy proposal_documents_versions_insert on public.proposal_documents_versions
for insert with check (exists (
  select 1 from public.proposal_documents d
  where d.id = proposal_documents_versions.document_id and public.can_edit_proposal(d.proposal_id)
));

-- ── 3. Review status ─────────────────────────────────────────────────────
alter table public.proposal_document_requests
  add column review_status text not null default 'pending'
    check (review_status in ('pending', 'received', 'under_review', 'revision_required', 'approved')),
  add column review_remark text,
  add column review_status_by uuid references public.afc_users(id),
  add column review_status_at timestamptz;

alter table public.proposal_afc_checklist_items
  add column review_status text not null default 'pending'
    check (review_status in ('pending', 'received', 'under_review', 'revision_required', 'approved')),
  add column review_remark text,
  add column review_status_by uuid references public.afc_users(id),
  add column review_status_at timestamptz;

alter table public.proposal_documents
  add column review_status text not null default 'pending'
    check (review_status in ('pending', 'received', 'under_review', 'revision_required', 'approved')),
  add column review_remark text,
  add column review_status_by uuid references public.afc_users(id),
  add column review_status_at timestamptz;
