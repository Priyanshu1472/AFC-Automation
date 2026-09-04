-- Team rename: "CBBO" -> "BIID". Team is a free-text column (no CHECK
-- constraint, no lookup table — see src/lib/roles.js's TEAMS comment), so
-- this is a plain data rename across every table that carries a team
-- value, alongside the updated seed constant in the app itself. Guarded
-- per-table with to_regclass so this stays a no-op (rather than an error)
-- against any environment where a given table doesn't exist/hasn't been
-- migrated yet.

do $$
begin
  if to_regclass('public.afc_users') is not null then
    update public.afc_users set team = 'BIID' where team = 'CBBO';
  end if;
  if to_regclass('public.empanelment_applications') is not null then
    update public.empanelment_applications set team = 'BIID' where team = 'CBBO';
  end if;
  if to_regclass('public.leads') is not null then
    update public.leads set team = 'BIID' where team = 'CBBO';
  end if;
  if to_regclass('public.projects') is not null then
    update public.projects set team = 'BIID' where team = 'CBBO';
  end if;
  if to_regclass('public.shortlists') is not null then
    update public.shortlists set team = 'BIID' where team = 'CBBO';
  end if;
end $$;
