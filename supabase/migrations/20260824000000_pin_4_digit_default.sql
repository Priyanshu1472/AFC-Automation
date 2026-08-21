-- PINs move from 5 digits to 4 (application-level change, see
-- supabase/functions/_shared/pin.ts) and every account now gets the same
-- default action PIN ("1234") instead of needing to set one before they
-- can act on a PIN-gated lead action — changeable any time from My
-- Profile, same idea as a default password. New accounts get this at
-- creation time (create-staff-user); this backfills every existing
-- account that has no PIN set yet.
--
-- pgcrypto's digest() reproduces hashPin()'s exact scheme
-- (SHA-256("<pin>:<user_id>"), lowercase hex) so this backfill and the JS
-- verification path in _shared/pin.ts can never disagree.
-- Supabase installs pgcrypto into the `extensions` schema (not `public`),
-- so digest() needs to be schema-qualified rather than relying on
-- search_path.
create extension if not exists pgcrypto with schema extensions;

update public.afc_users
set pin_hash = encode(extensions.digest('1234:' || id::text, 'sha256'), 'hex'),
    pin_updated_at = now()
where pin_hash is null;
