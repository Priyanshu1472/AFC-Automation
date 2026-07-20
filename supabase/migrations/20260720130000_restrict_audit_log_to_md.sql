-- The Audit Logs page is MD-only in the UI; tighten the RLS policy to
-- match, so DB access can't diverge from what the app actually shows
-- (cfo/cs previously had read access here even though nothing in the UI
-- exposed it to them).
drop policy if exists audit_log_select_org_wide on public.application_audit_log;

create policy audit_log_select_md_only on public.application_audit_log
for select using (
  (select role from public.afc_users where id = auth.uid()) = 'md'
);
