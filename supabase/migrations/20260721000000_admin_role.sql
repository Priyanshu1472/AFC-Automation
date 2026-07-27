-- New `admin` role — a dedicated account-management role, split out of
-- MD/DGM. Admin gets full manage rights on afc_users (see the
-- create-staff-user / update-staff-user / set-user-status edge functions)
-- and read-only org-wide visibility into the empanelment pipeline, same
-- shape as md/cfo/cs's existing org-wide read access. Office is still
-- required for admin, same as every non-md role.

alter table public.afc_users drop constraint afc_users_role_check;
alter table public.afc_users add constraint afc_users_role_check
  check (role in ('md','cfo','cs','dgm','agm','srm','project_officer','associate_consultant','business_associate','admin'));

-- afc_users org-wide read (was md/cfo/cs only).
drop policy afc_users_select_org_wide on public.afc_users;
create policy afc_users_select_org_wide on public.afc_users
for select using (public.current_afc_role() in ('md', 'cfo', 'cs', 'admin'));

-- Empanelment applications/registrations/activity/compliance-flags org-wide
-- read (was md/cfo/cs only) — see can_view_empanelment_application in
-- 20260717160000_empanelment_schema.sql, extended for business_associate in
-- 20260720010000_business_associate_role.sql.
create or replace function public.can_view_empanelment_application(app_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empanelment_applications a
    where a.id = app_id
      and (
        public.current_afc_role() in ('md', 'cfo', 'cs', 'admin')
        or (public.current_afc_role() = 'dgm' and a.team = public.current_afc_team())
        or (public.current_afc_role() = 'project_officer' and a.project_officer_id = auth.uid())
        or (public.current_afc_role() = 'associate_consultant' and a.sent_by = auth.uid())
        or (public.current_afc_role() = 'business_associate' and a.ba_user_id = auth.uid())
      )
  );
$$;
