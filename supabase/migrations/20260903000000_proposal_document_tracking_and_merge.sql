-- Proposal Preparation: file-upload tracking on the BA document-request list
-- and the internal AFC checklist, BA reminder-send counters, and a new
-- table to persist "Merge Proposal" output.
--
-- Verified live against afc-automation-dev before writing this (these
-- tables were originally pushed outside git — see 20260820040000):
--   - can_view_proposal() and can_edit_proposal() both already exist.
--   - proposal_document_requests already has an UPDATE policy gated by
--     can_edit_proposal(), so the new file_* columns below need no RLS
--     change to be writable.
--   - proposal_afc_checklist_items already has an UPDATE policy the same
--     way (exercised today by the checkbox toggle).
--   - proposal-documents' storage INSERT policy is already a generic
--     `split_part(name,'/',1)::uuid` + can_edit_proposal() check, so any
--     new path under `${proposalId}/...` (ba_request_*, checklist_*,
--     merged_*) is already covered — no storage policy change needed.
--   - proposal_documents.doc_type has a hard CHECK constrained to
--     ('technical','financial','proposal_3') — the merged-proposal output
--     cannot reuse that table, hence the new proposal_merged_files table.
--   - proposal_preparations has no client-facing INSERT/UPDATE policy at
--     all (writes only via service-role edge functions), so the new
--     ba_send_count/ba_last_sent_at columns are only ever touched by
--     send-ba-document-request.

-- ── proposal_document_requests: AFC uploads the file once received from
-- the BA through any channel (email/WhatsApp/etc) — there's no BA-facing
-- self-serve upload page in this iteration. ──────────────────────────
alter table public.proposal_document_requests
  add column file_name   text,
  add column file_path   text,
  add column file_size   bigint,
  add column uploaded_at timestamptz,
  add column uploaded_by uuid references public.afc_users(id);

-- ── proposal_afc_checklist_items: two ways in — a plain upload, or
-- pulling an existing file straight from the Knowledge Repository. ────
alter table public.proposal_afc_checklist_items
  add column file_name   text,
  add column file_path   text,
  add column file_size   bigint,
  add column uploaded_at timestamptz,
  add column uploaded_by uuid references public.afc_users(id),
  add column source      text check (source in ('upload', 'knowledge_repository')),
  add column source_project_document_id uuid references public.project_documents(id) on delete set null;

-- ── proposal_preparations: lets the UI show "Send to BA" vs "Send
-- Reminder" without inferring it from item rows. ──────────────────────
alter table public.proposal_preparations
  add column ba_send_count   integer not null default 0,
  add column ba_last_sent_at timestamptz;

-- ── proposal_merged_files: one immutable row per "Merge Proposal" run —
-- regenerating just inserts a new row, giving free version history. ───
create table public.proposal_merged_files (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposal_preparations(id) on delete cascade,
  file_name   text not null,
  file_path   text not null,
  file_size   bigint,
  -- Ordered [{ source, label, file_name }] describing what went into this
  -- run, for later reference — not used to rebuild anything automatically.
  manifest    jsonb not null default '[]',
  proceeded_with_missing boolean not null default false,
  created_by  uuid references public.afc_users(id),
  created_at  timestamptz not null default now()
);

create index proposal_merged_files_proposal_idx on public.proposal_merged_files(proposal_id);

alter table public.proposal_merged_files enable row level security;

create policy proposal_merged_files_select on public.proposal_merged_files
for select using (public.can_view_proposal(proposal_id));

create policy proposal_merged_files_insert on public.proposal_merged_files
for insert with check (public.can_edit_proposal(proposal_id));

create policy proposal_merged_files_delete on public.proposal_merged_files
for delete using (public.can_edit_proposal(proposal_id));
