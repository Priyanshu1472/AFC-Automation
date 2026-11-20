-- Super Admin gets every Admin power (on top of Module Settings).
--
-- Rather than adding 'super_admin' next to 'admin' in every policy/function
-- (12 functions + ~10 policies today, and every future one), the role
-- helper itself reports an ACTIVE super_admin as 'admin'. Every
-- current_afc_role() check — "= 'admin'", "in ('md','admin')", etc. —
-- then covers Super Admin automatically. Module Settings keeps its own
-- is_active_super_admin() check, so Admin still can't switch modules.
--
-- The edge functions (_shared/auth.ts getCallerProfile) and the frontend
-- (AuthContext fetchProfile) apply the same mapping.

create or replace function public.current_afc_role()
returns text
language sql stable security definer set search_path = public as $$
  select case
    when role = 'super_admin' and is_active then 'admin'
    else role
  end
  from public.afc_users where id = auth.uid();
$$;

-- These two policies read afc_users.role directly instead of going
-- through current_afc_role() — switch them over so they get the mapping.
drop policy if exists audit_log_select_admin_only on public.application_audit_log;
create policy audit_log_select_admin_only on public.application_audit_log
  for select using (public.current_afc_role() = 'admin');

do $$
begin
  if to_regclass('public.experience_import_ledger') is not null then
    execute 'drop policy if exists experience_import_ledger_select on public.experience_import_ledger';
    execute $p$create policy experience_import_ledger_select on public.experience_import_ledger
      for select using (public.current_afc_role() in ('md', 'cfo', 'cs', 'admin'))$p$;
  end if;
end $$;
