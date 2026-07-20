-- The public (verify_jwt = false) BA-facing functions — submit-ba-form,
-- submit-empanelment-correction, get-empanelment-correction-info — were
-- rate-limiting brute-force attempts against the 5-digit application_code
-- with an in-memory Map. Supabase Edge Functions run as distributed,
-- ephemeral instances, so that counter isn't actually shared across
-- instances and resets on every cold start — an attacker spreading
-- requests across source IPs (or just waiting for a cold start) bypasses
-- it entirely. This replaces it with a durable, atomic, DB-backed limiter
-- shared by every instance.
create table public.rate_limit_attempts (
  key          text primary key,
  count        integer not null default 1,
  window_start timestamptz not null default now()
);

-- No RLS policies at all — zero direct access for anon/authenticated,
-- same convention as every other write-path table in this schema. Only
-- the SECURITY DEFINER function below (called via the service-role client
-- in edge functions) touches this table.
alter table public.rate_limit_attempts enable row level security;

create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns table(allowed boolean, wait_seconds integer)
language plpgsql security definer set search_path = public as $$
declare
  rec public.rate_limit_attempts;
begin
  -- Row lock serializes concurrent hits on the same key so two requests
  -- racing in the same instant can't both slip through as "count 1".
  select * into rec from public.rate_limit_attempts where key = p_key for update;

  if rec is null then
    insert into public.rate_limit_attempts (key, count, window_start) values (p_key, 1, now());
    return query select true, 0;
    return;
  end if;

  if now() > rec.window_start + make_interval(secs => p_window_seconds) then
    update public.rate_limit_attempts set count = 1, window_start = now() where key = p_key;
    return query select true, 0;
    return;
  end if;

  if rec.count >= p_max then
    return query select false, greatest(0, ceil(extract(epoch from (rec.window_start + make_interval(secs => p_window_seconds) - now())))::integer);
    return;
  end if;

  update public.rate_limit_attempts set count = count + 1 where key = p_key;
  return query select true, 0;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- Opportunistic cleanup — called from the same function so no cron job is
-- needed; cheap no-op most of the time since it only ever deletes rows
-- whose window closed at least a day ago.
create or replace function public.cleanup_rate_limit_attempts()
returns void
language sql security definer set search_path = public as $$
  delete from public.rate_limit_attempts where window_start < now() - interval '1 day';
$$;

revoke all on function public.cleanup_rate_limit_attempts() from public;
grant execute on function public.cleanup_rate_limit_attempts() to service_role;
