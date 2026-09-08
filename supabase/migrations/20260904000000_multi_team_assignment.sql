-- Multi-team assignment: a team-scoped user (dgm/agm/srm/project_officer/
-- associate_consultant/project_assistant) can now be assigned to more than
-- one team (e.g. a DGM covering both BPDD and HO), with a client-side
-- "active team" switcher narrowing the app back down to one team at a time.
--
-- afc_users.team stays a plain scalar — the user's PRIMARY team, unchanged
-- in meaning and still what current_afc_team() reads, so every existing
-- single-team-read call site keeps working untouched. The new
-- afc_user_teams junction table holds the FULL set (primary team included)
-- and is the new source of truth for "is this user allowed to see team X's
-- data" — is_current_user_team() replaces every RLS-facing
-- `team = current_afc_team()` comparison with a membership check.

create table public.afc_user_teams (
  user_id    uuid not null references public.afc_users(id) on delete cascade,
  team       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, team)
);

create index afc_user_teams_user_idx on public.afc_user_teams(user_id);

alter table public.afc_user_teams enable row level security;
-- No client-facing policies — only read via the SECURITY DEFINER function
-- below, and written by the create-staff-user/update-staff-user edge
-- functions using the service-role key (same convention as
-- lead_number_counters).

insert into public.afc_user_teams (user_id, team)
select id, team from public.afc_users where team is not null;

create or replace function public.is_current_user_team(target_team text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.afc_user_teams
    where user_id = auth.uid() and team = target_team
  );
$$;

-- ── afc_users_select_dgm_team (20260717064949) ─────────────────────
drop policy if exists afc_users_select_dgm_team on public.afc_users;
create policy afc_users_select_dgm_team on public.afc_users
for select using (
  public.current_afc_role() = 'dgm' and public.is_current_user_team(team)
);

-- ── afc_users_select_team_reviewers (20260717170000) ───────────────
drop policy if exists afc_users_select_team_reviewers on public.afc_users;
create policy afc_users_select_team_reviewers on public.afc_users
for select using (
  role in ('project_officer', 'dgm')
  and is_active = true
  and public.is_current_user_team(team)
);

-- ── afc_users_select_own_team_active (latest: 20260820000000) ──────
drop policy if exists afc_users_select_own_team_active on public.afc_users;
create policy afc_users_select_own_team_active on public.afc_users
for select using (
  is_active = true
  and (
    public.is_current_user_team(team)
    or committee in ('PMT', 'PMT Extended', 'G3')
    or public.current_afc_committee() in ('PMT', 'PMT Extended', 'G3')
  )
);

-- ── can_view_empanelment_application (latest: 20260728000000) ──────
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
          and public.is_current_user_team(a.team)
        )
        or (public.current_afc_role() = 'business_associate' and a.ba_user_id = auth.uid())
      )
  );
$$;

-- ── can_view_lead (latest: 20260903030000) ──────────────────────────
create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs')
        or (
          public.current_afc_role() = 'dgm'
          and public.is_current_user_team(l.team)
        )
        or (
          l.status not in ('pa_review', 'pa_action_required')
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee in ('PMT', 'PMT Extended', 'G3'))
        )
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.approval_authority_id, l.handled_by_dgm_id)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;

-- ── can_edit_project (20260722020000) ───────────────────────────────
create or replace function public.can_edit_project(p_created_by uuid, p_team text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    auth.uid() = p_created_by
    or public.current_afc_role() = 'md'
    or (public.current_afc_role() = 'dgm' and public.is_current_user_team(p_team));
$$;
