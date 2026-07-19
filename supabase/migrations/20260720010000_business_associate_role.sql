-- A Business Associate gets a real portal account once MD accepts their
-- empanelment application, so they can log in and see their own status.
-- They are not staff — no office/team — and RLS scopes them to exactly the
-- one application tied to their account via ba_user_id.

alter table public.afc_users drop constraint afc_users_role_check;
alter table public.afc_users add constraint afc_users_role_check
  check (role in ('md','cfo','cs','dgm','agm','srm','project_officer','associate_consultant','business_associate'));

alter table public.afc_users drop constraint afc_users_office_required_check;
alter table public.afc_users add constraint afc_users_office_required_check
  check (role in ('md', 'business_associate') or office is not null);

alter table public.empanelment_applications
  add column ba_user_id uuid references public.afc_users(id);

create or replace function public.can_view_empanelment_application(app_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empanelment_applications a
    where a.id = app_id
      and (
        public.current_afc_role() in ('md', 'cfo', 'cs')
        or (public.current_afc_role() = 'dgm' and a.team = public.current_afc_team())
        or (public.current_afc_role() = 'project_officer' and a.project_officer_id = auth.uid())
        or (public.current_afc_role() = 'associate_consultant' and a.sent_by = auth.uid())
        or (public.current_afc_role() = 'business_associate' and a.ba_user_id = auth.uid())
      )
  );
$$;
