-- Removes "Generate Final Proposal" (proposal_generation_jobs) — the
-- feature (and its Dockerized worker) is being pulled back out, not
-- pursued further. Drops the table this session's 3 migrations built
-- (20260918000000 / 20260919000000 / 20260920000000); those files are
-- left in place as history rather than deleted, same convention as
-- 20260917000000_revert_to_checklist_workflow.sql. No data of any real
-- value existed in this table (test-generation rows only, and the
-- generated PDFs/DOCX themselves already live in the proposal-documents
-- bucket independent of this table — untouched by this drop).
drop table if exists public.proposal_generation_jobs;
