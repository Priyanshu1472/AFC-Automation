-- New `project_assistant` role — same permissions/visibility as
-- associate_consultant (can send empanelment invitations, sees their own
-- team's applications). Kept as its own role rather than aliased to
-- associate_consultant so titles stay accurate on the roster.

alter table public.afc_users drop constraint afc_users_role_check;
alter table public.afc_users add constraint afc_users_role_check
  check (role in ('md','cfo','cs','dgm','agm','srm','project_officer','associate_consultant','project_assistant','business_associate','admin'));

create or replace function public.can_view_empanelment_application(app_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empanelment_applications a
    where a.id = app_id
      and (
        public.current_afc_role() in ('md', 'cfo', 'cs', 'admin')
        or (
          public.current_afc_role() in ('dgm', 'agm', 'srm', 'project_officer', 'associate_consultant', 'project_assistant')
          and a.team = public.current_afc_team()
        )
        or (public.current_afc_role() = 'business_associate' and a.ba_user_id = auth.uid())
      )
  );
$$;
