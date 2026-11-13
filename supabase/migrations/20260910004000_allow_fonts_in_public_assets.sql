-- The public-assets bucket only allowed image/png and image/jpeg (it's held
-- just the AFC logo so far). Widening it to also allow font/ttf so the
-- Gelasio font files used by the Fee Note PDF (see
-- supabase/functions/_shared/feeNotePdf.ts) can live alongside the logo,
-- fetched the same way at PDF-generation time.
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'font/ttf', 'font/otf']
where name = 'public-assets';
