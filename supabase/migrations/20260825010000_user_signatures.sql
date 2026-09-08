-- User signature images — uploaded by Admin on Create/Edit User, embedded
-- into generated PDFs (Lead Approval Note) alongside the signer's printed
-- name. One signature per user, stored as a private storage object; the
-- path (not the image itself) lives on afc_users.

alter table public.afc_users add column if not exists signature_path text;

-- Private bucket, same convention as lead-documents/ba-documents — no
-- storage.objects RLS policies for authenticated/anon, every read/write
-- goes through a service-role edge function (upload-user-signature,
-- get-user-signature-url).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-signatures', 'user-signatures', false, 2097152,
  array['image/png', 'image/jpeg']
)
on conflict (id) do nothing;
