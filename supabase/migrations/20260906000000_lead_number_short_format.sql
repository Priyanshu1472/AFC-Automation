-- Lead number format: "AFC/<TEAM>/Lead/<FY start year>/<seq>" ->
-- "AFC/<TEAM>/L/<FY start year's last 2 digits>/<seq>", e.g.
-- "AFC/BPDD/Lead/2026/001" -> "AFC/BPDD/L/26/001". Shorter "L" instead of
-- "Lead", and a 2-digit year instead of 4 — per product decision.
--
-- Existing lead numbers already issued keep their old format untouched —
-- same "format changes going forward only" approach as the previous two
-- next_lead_number rewrites (20260820000000, 20260903020000). The counter
-- table/logic (per team + financial year) is unchanged, only the string
-- this function returns.

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

  return 'AFC/' || v_team || '/L/' || right(v_fy_start::text, 2) || '/' || lpad(v_counter::text, 3, '0');
end;
$$;
