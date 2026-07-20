-- Tracks whether the DGM has sent the (non-final) Provisional Empanelment
-- Letter for an application, so the button in the UI can be disabled once
-- sent instead of allowing duplicates.
alter table public.empanelment_applications
  add column provisional_letter_sent boolean not null default false,
  add column provisional_sent_at timestamptz;

-- Public bucket for static branding assets (currently just the letterhead
-- logo) the send-provisional-letter edge function embeds into the PDF.
-- Public because it's fetched by an unauthenticated `fetch()` call from the
-- edge function, same as any other static asset — nothing sensitive here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-assets', 'public-assets', true, 5242880, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;
