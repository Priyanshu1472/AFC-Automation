-- The Audit Logs page (Account Management tab) is now Admin-only in the
-- UI — tighten the RLS policy to match, same reasoning as the earlier
-- MD-only tightening (20260720130000): DB access shouldn't be able to
-- diverge from what the app actually shows. MD loses read access here now
-- that user-management itself is Admin-only end to end.
drop policy if exists audit_log_select_md_only on public.application_audit_log;

create policy audit_log_select_admin_only on public.application_audit_log
for select using (
  (select role from public.afc_users where id = auth.uid()) = 'admin'
);
