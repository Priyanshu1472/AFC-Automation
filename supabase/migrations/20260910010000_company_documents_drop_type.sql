-- Drop the "Type" field from Company Documents — dropped from the UI per
-- product feedback right after the feature was built (no category concept
-- needed; documents are just named). `if exists` so this is safe to run
-- whether or not 20260910000000_company_documents.sql has been applied yet.
alter table public.company_documents drop column if exists doc_type;
