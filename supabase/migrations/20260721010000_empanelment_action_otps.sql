-- One-time codes gating MD's accept/reject decision and the DGM's
-- provisional-letter send — both actions email out (BA decision mail /
-- portal credentials / provisional letter) and must be re-confirmed by the
-- actor via a code emailed to their own registered address before the real
-- action (and its email) fires. See supabase/functions/_shared/otp.ts and
-- request-empanelment-otp. Same no-authenticated-access convention as
-- rate_limit_attempts (20260720160000_db_rate_limit.sql) — only service-role
-- edge functions touch this table.

create table public.empanelment_action_otps (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.afc_users(id),
  application_id  uuid not null references public.empanelment_applications(id) on delete cascade,
  action          text not null check (action in ('md_accept', 'md_reject', 'provisional_letter')),
  otp_hash        text not null,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index empanelment_action_otps_lookup_idx
  on public.empanelment_action_otps(user_id, application_id, action, created_at desc);

alter table public.empanelment_action_otps enable row level security;

-- Opportunistic cleanup of long-expired rows — mirrors
-- cleanup_rate_limit_attempts (available for a future scheduled job; not
-- wired into the request path itself, same as its rate-limit counterpart).
create or replace function public.cleanup_empanelment_action_otps()
returns void
language sql security definer set search_path = public as $$
  delete from public.empanelment_action_otps where created_at < now() - interval '1 day';
$$;

revoke all on function public.cleanup_empanelment_action_otps() from public;
grant execute on function public.cleanup_empanelment_action_otps() to service_role;
