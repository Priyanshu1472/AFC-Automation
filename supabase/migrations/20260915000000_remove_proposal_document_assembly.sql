-- Remove the Proposal Preparation "document assembly" cluster — BP document
-- requests, the AFC internal checklist, the three proposal-document slots,
-- their version-history tables, and Merge Proposal's output log. The merge
-- quality and UI for this whole workflow weren't landing (client-side DOCX
-- XML-splicing plus PDF rasterization — see docxTrueMerge.js, now deleted);
-- it'll be rebuilt from scratch once a real DOCX->PDF conversion approach is
-- in place. The Bid Payment Requisition Note (fee_notes/fee_note_events) and
-- the lock/client-outcome step are unrelated and untouched.
--
-- Irreversible: at the time of writing this dropped 21 rows from
-- proposal_document_requests, 15 from proposal_afc_checklist_items, 9 from
-- proposal_merged_files, and 2 from proposal_document_request_versions.
-- Files already sitting in the proposal-documents storage bucket are not
-- deleted by this (Storage isn't touched by a table drop) — they're simply
-- orphaned, which is harmless.

drop table if exists public.proposal_document_request_versions cascade;
drop table if exists public.proposal_afc_checklist_item_versions cascade;
drop table if exists public.proposal_documents_versions cascade;
drop table if exists public.proposal_merged_files cascade;
drop table if exists public.proposal_document_requests cascade;
drop table if exists public.proposal_afc_checklist_items cascade;
drop table if exists public.proposal_documents cascade;
