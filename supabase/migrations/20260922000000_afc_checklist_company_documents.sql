-- Let the AFC Internal Checklist's "Pick from Knowledge Repository" picker
-- attach a Company Document (not just a project document) to a checklist
-- item. Mirrors source_project_document_id: a nullable FK plus a new
-- 'company_documents' value in the source check constraint.
alter table public.proposal_afc_checklist_items
  add column source_company_document_id uuid references public.company_documents(id) on delete set null;

alter table public.proposal_afc_checklist_items
  drop constraint if exists proposal_afc_checklist_items_source_check;

alter table public.proposal_afc_checklist_items
  add constraint proposal_afc_checklist_items_source_check
  check (source in ('upload', 'knowledge_repository', 'company_documents'));
