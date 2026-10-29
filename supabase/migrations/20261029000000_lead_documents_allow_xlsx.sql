-- Allow Excel (.xlsx) uploads on lead documents, alongside the existing
-- PDF/DOC/DOCX. The 10MB per-file limit was already in place (bucket and
-- both create-lead/update-lead edge functions already enforce it) —
-- nothing to change there.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id = 'lead-documents';
