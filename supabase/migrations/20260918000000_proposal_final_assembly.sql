-- Final Proposal Generation ("Generate Final Proposal") — assembles a
-- user-chosen, user-ordered subset of a proposal's existing documents
-- (BP requests / AFC checklist / the three Proposal Documents slots — all
-- three tables recreated in 20260917000000_revert_to_checklist_workflow.sql,
-- untouched by this migration) into one client-facing PDF with a cover,
-- TOC, and page numbering.
--
-- Deliberately no new document-storage table: an eligible document is
-- still whichever row already exists in proposal_document_requests /
-- proposal_afc_checklist_items / proposal_documents. This table only
-- records ONE generation request — the server-verified snapshot of which
-- of those existing rows were selected, in what order, plus the resulting
-- output file. The actual DOCX->PDF conversion and PDF assembly happens
-- in a separate Dockerized worker (LibreOffice + PyMuPDF/pypdf +
-- ReportLab) that polls this table via the Supabase service-role key
-- (no RLS bypass needed elsewhere) — there is no queue/webhook
-- infrastructure anywhere else in this project to plug into, so simple
-- polling is the smallest reliable mechanism (see
-- create-proposal-generation-job/index.ts, proposal-worker/).

create table public.proposal_generation_jobs (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null references public.proposal_preparations(id) on delete cascade,
  requested_by      uuid references public.afc_users(id),
  status            text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  -- Server-verified snapshot at request time — [{source, source_id, label,
  -- file_name, file_path, ext}], in the exact final order. Never taken
  -- from the client as-is: create-proposal-generation-job re-derives
  -- label/file_name/file_path from the source row itself for every id the
  -- client sent, so a client can select existing documents and their
  -- order but can never inject an arbitrary path or label.
  selected_items    jsonb not null default '[]',
  error_message     text,
  output_file_name  text,
  output_file_path  text,
  output_file_size  bigint,
  claimed_at        timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index proposal_generation_jobs_proposal_idx on public.proposal_generation_jobs(proposal_id, created_at desc);
-- The worker's poll query is `status = 'queued' order by created_at limit N`
-- — a plain btree on status covers that fine at this volume (300-400/yr).
create index proposal_generation_jobs_status_idx on public.proposal_generation_jobs(status);

alter table public.proposal_generation_jobs enable row level security;

-- Read-only for authenticated users (the frontend polls/subscribes to its
-- own proposal's jobs) — every write (create, claim, complete, fail) goes
-- through either create-proposal-generation-job or the worker, both
-- service-role, same convention as lead_chat_messages/proposal_documents'
-- sibling tables that route writes through an edge function.
create policy proposal_generation_jobs_select on public.proposal_generation_jobs
for select using (public.can_view_proposal(proposal_id));

alter publication supabase_realtime add table public.proposal_generation_jobs;
