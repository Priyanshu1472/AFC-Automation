-- action_by already references auth.users(id); add a second FK to
-- public.afc_users(id) (same underlying id) so PostgREST can embed the
-- actor's profile (full_name, role, team, office) directly in a select,
-- e.g. .select("*, actor:action_by(full_name, role, team, office)").
alter table public.application_audit_log
  add constraint application_audit_log_action_by_afc_users_fkey
  foreign key (action_by) references public.afc_users(id);
