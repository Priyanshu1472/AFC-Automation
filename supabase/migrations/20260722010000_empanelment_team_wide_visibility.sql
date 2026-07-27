-- The Empanelment list/dashboard/reports were meant to be visible to a
-- whole team, but the RLS policy only ever gave DGM full team-wide access —
-- Project Officer and Associate Consultant were scoped to just their own
-- assigned/sent applications, and AGM/SRM had no branch at all (so they saw
-- nothing). Every team-scoped role should see every application raised
-- for their own team, regardless of who sent it or who's assigned as PO.
-- Write-side authorization (who can actually act at each stage) is
-- unaffected — that's enforced independently in the edge functions
-- (advance-empanelment-stage etc.), not by this read policy.
create or replace function public.can_view_empanelment_application(app_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empanelment_applications a
    where a.id = app_id
      and (
        public.current_afc_role() in ('md', 'cfo', 'cs', 'admin')
        or (
          public.current_afc_role() in ('dgm', 'agm', 'srm', 'project_officer', 'associate_consultant')
          and a.team = public.current_afc_team()
        )
        or (public.current_afc_role() = 'business_associate' and a.ba_user_id = auth.uid())
      )
  );
$$;
