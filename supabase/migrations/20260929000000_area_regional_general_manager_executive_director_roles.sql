-- Adds four new roles: area_manager and regional_manager (full parity with
-- project_officer — same permission tier, same eligibility for the
-- project_officer_id "reviewing Project Officer" assignment slot on
-- empanelment applications), general_manager (full parity with dgm — same
-- permission tier, same eligibility for the dgm_id "advising DGM"
-- assignment slot, and can_edit_project knowledge-repo rights), and
-- executive_director (valid, Admin-creatable role with zero elevated
-- permissions for now — deliberately NOT added to any policy below; a
-- future migration will grant it permissions when product defines them).

-- ── afc_users_role_check ────────────────────────────────────────────
alter table public.afc_users drop constraint afc_users_role_check;
alter table public.afc_users add constraint afc_users_role_check
  check (role in (
    'md','cfo','cs','dgm','agm','srm','project_officer','associate_consultant',
    'project_assistant','business_associate','admin',
    'area_manager','regional_manager','general_manager','executive_director'
  ));

-- ── afc_users_select_team_reviewers (latest: 20260904000000) ───────
drop policy if exists afc_users_select_team_reviewers on public.afc_users;
create policy afc_users_select_team_reviewers on public.afc_users
for select using (
  role in ('project_officer', 'dgm', 'area_manager', 'regional_manager', 'general_manager')
  and is_active = true
  and public.is_current_user_team(team)
);

-- ── can_edit_project (latest: 20260722020000) ───────────────────────
create or replace function public.can_edit_project(p_created_by uuid, p_team text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    auth.uid() = p_created_by
    or public.current_afc_role() = 'md'
    or (public.current_afc_role() in ('dgm', 'general_manager') and p_team = public.current_afc_team());
$$;

-- ── can_view_empanelment_application (latest: 20260904000000) ───────
create or replace function public.can_view_empanelment_application(app_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empanelment_applications a
    where a.id = app_id
      and (
        public.current_afc_role() in ('md', 'cfo', 'cs', 'admin')
        or (
          public.current_afc_role() in (
            'dgm', 'agm', 'srm', 'project_officer', 'associate_consultant', 'project_assistant',
            'area_manager', 'regional_manager', 'general_manager'
          )
          and public.is_current_user_team(a.team)
        )
        or (public.current_afc_role() = 'business_associate' and a.ba_user_id = auth.uid())
      )
  );
$$;

-- ── can_view_lead (latest: 20260928000200) ───────────────────────────
create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm', 'general_manager')
        or exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT')
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.recommending_authority_id, l.handled_by_dgm_id)
        or (l.person_responsible_id is null and public.is_current_user_team(l.team))
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;

-- ── afc_users_select_own_team_active (latest: 20260928000400) ───────
drop policy if exists afc_users_select_own_team_active on public.afc_users;
create policy afc_users_select_own_team_active on public.afc_users
for select using (
  is_active = true
  and (
    public.is_current_user_team(team)
    or committee = 'PMT'
    or public.current_afc_committee() = 'PMT'
    or public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm', 'general_manager')
  )
);
