-- "Generate Final Proposal" now produces both a PDF and a Word download
-- (see proposal-worker/app/document_converter.py's convert_pdf_to_docx —
-- the DOCX is derived FROM the already-finalized PDF via LibreOffice, so
-- it carries the same cover/TOC/page numbers/order; best-effort, since
-- PDF->DOCX reconstruction is lossier than the DOCX->PDF direction —
-- a job can still complete with the PDF only). Splits the old single
-- output_file_name/path/size into per-format columns; no data worth
-- preserving (this table is brand new, and its only prior row was a
-- stuck test job with no output yet).
alter table public.proposal_generation_jobs
  drop column if exists output_file_name,
  drop column if exists output_file_path,
  drop column if exists output_file_size;

alter table public.proposal_generation_jobs
  add column if not exists output_pdf_name  text,
  add column if not exists output_pdf_path  text,
  add column if not exists output_pdf_size  bigint,
  add column if not exists output_docx_name text,
  add column if not exists output_docx_path text,
  add column if not exists output_docx_size bigint;
