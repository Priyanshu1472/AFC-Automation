-- Lifts the storage-bucket-level restrictions on lead-documents, matching
-- the create-lead/update-lead edge functions' own validateDocument() no
-- longer rejecting by type or size (see the same commit). Without this,
-- the bucket itself would still reject anything outside the old
-- PDF/DOC/DOCX/XLSX allowlist or over 10MB before the function's own
-- (now permissive) check ever runs.
update storage.buckets
set file_size_limit = null, allowed_mime_types = null
where id = 'lead-documents';
