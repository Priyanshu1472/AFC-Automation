-- Lead number format: "AFC/Lead/<year>/<seq>" -> "AFC/<TEAM>/Lead/<FY start
-- year>/<seq>", with the sequence now counted separately per (team,
-- financial year) instead of one number shared across every team —
-- otherwise a team prefix would be decorative rather than meaningful.
-- Financial year = 1 Apr - 31 Mar (per product decision), labeled by its
-- start year (e.g. a lead created any time between 1 Apr 2026 and 31 Mar
-- 2027 is "FY 2026" -> ".../2026/...").
--
-- Existing lead numbers already issued keep their old format untouched —
-- same "format changes going forward only" approach as the previous
-- next_lead_number rewrite (20260820000000). No backfill: each team's
-- counter starts fresh at 1 for the current financial year rather than
-- inheriting a count from the old shared sequence, which never tracked
-- per-team volume to begin with.

create table if not exists public.lead_number_counters (
  team          text not null,
  fy_start_year integer not null,
  counter       integer not null default 0,
  primary key (team, fy_start_year)
);

-- RLS enabled with no policies at all — purely internal bookkeeping for
-- next_lead_number() below, never queried directly by a client. The
-- SECURITY DEFINER function still reads/writes it fine, same as every
-- other SECURITY DEFINER function in this schema already does against
-- RLS-locked tables (e.g. leads, lead_chat_messages).
alter table public.lead_number_counters enable row level security;

create or replace function public.current_financial_year_start()
returns integer
language sql
stable
as $$
  select case when extract(month from now()) >= 4
    then extract(year from now())::integer
    else extract(year from now())::integer - 1
  end;
$$;

-- create or replace can't change an existing function's argument list —
-- the old zero-arg version is a distinct overload that would otherwise be
-- left behind, unused.
drop function if exists public.next_lead_number();

create or replace function public.next_lead_number(p_team text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team text := upper(coalesce(nullif(trim(p_team), ''), 'GEN'));
  v_fy_start integer := public.current_financial_year_start();
  v_counter integer;
begin
  insert into public.lead_number_counters (team, fy_start_year, counter)
  values (v_team, v_fy_start, 1)
  on conflict (team, fy_start_year)
  do update set counter = lead_number_counters.counter + 1
  returning counter into v_counter;

  return 'AFC/' || v_team || '/Lead/' || v_fy_start::text || '/' || lpad(v_counter::text, 3, '0');
end;
$$;
-- Not granted to `authenticated` — only ever called from create-lead via
-- the service-role client, same posture as before.
