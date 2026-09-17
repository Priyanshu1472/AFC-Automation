-- Experience Intelligence integration — the "Experience Import Gateway".
-- Experience Intelligence (a separate local AI application, see
-- experience-intelligence/docs/portal-integration.md in that repo) proposes
-- AI-extracted historical projects for the Knowledge Repository after a
-- human has reviewed and approved them. It never touches this database
-- directly — it only calls the `experience-import` edge function over
-- HTTPS with a signed service token, which performs the actual writes
-- using the same `projects`/`keywords`/`project_keyword_details` tables
-- the Add Project page already uses.
--
-- This migration adds only the idempotency ledger that function needs —
-- one row per project ever imported through this gateway, keyed by the
-- idempotency_key Experience Intelligence generates
-- (`{batch_id}:{assignment_number_or_id}`), so retried/duplicate submissions
-- (network timeout, double-click "Approve") return the original result
-- instead of creating a second project.

create table public.experience_import_ledger (
  idempotency_key text primary key,
  project_id      uuid not null references public.projects(id) on delete cascade,
  batch_id        text not null,
  initiated_by    text,
  created_at      timestamptz not null default now()
);

create index experience_import_ledger_project_idx on public.experience_import_ledger(project_id);
create index experience_import_ledger_batch_idx on public.experience_import_ledger(batch_id);

-- Service-role only (the edge function uses the admin client, which
-- bypasses RLS entirely) — no policies needed for `authenticated`/`anon`,
-- matching application_audit_log's "no insert policy, service-role writes
-- only" pattern. RLS is still enabled so a future accidental grant doesn't
-- silently expose it.
alter table public.experience_import_ledger enable row level security;

create policy experience_import_ledger_select on public.experience_import_ledger
for select using (
  (select role from public.afc_users where id = auth.uid()) in ('md', 'cfo', 'cs', 'admin')
);
