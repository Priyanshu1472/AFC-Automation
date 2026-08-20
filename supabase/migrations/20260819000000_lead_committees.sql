-- Replaces the standalone lead_role_assignments tag system with the
-- existing afc_users.role (already assigned at user creation, on the
-- Users page) as the universal authorization source for Lead Generation,
-- plus a new afc_users.committee column for the three review committees
-- (PMT, PMT Extended, G3 — G3 being the DGM committee: membership grants
-- DGM-equivalent lead-workflow permission, org-wide, matching the org's
-- 3-DGM/4-team pooling rule). No separate role-assignment table or admin
-- page — committee is just another field on the existing Create/Edit User
-- flow, per explicit product decision to keep one universal role/assignment
-- surface instead of a parallel one for this module.

alter table public.afc_users
  add column if not exists committee text check (committee in ('PMT', 'PMT Extended', 'G3'));

create index if not exists afc_users_committee_idx on public.afc_users(committee, team);

-- ── Drop the old tag-based objects ─────────────────────────────────
drop policy if exists lead_role_assignments_select on public.lead_role_assignments;
drop policy if exists afc_users_select_lead_gen_teammates on public.afc_users;
drop table if exists public.lead_role_assignments cascade;

-- ── afc_users visibility — needed to populate the Person Responsible /
-- Reviewer / Approval Authority dropdowns on the lead form, now that
-- eligibility is read straight off afc_users.role/committee/team. Same
-- narrow-policy pattern as afc_users_select_team_reviewers
-- (20260717170000): any active teammate is visible, nothing else about
-- them is exposed beyond what afc_users already carries. ──────────────
drop policy if exists afc_users_select_own_team_active on public.afc_users;
create policy afc_users_select_own_team_active on public.afc_users
for select using (is_active = true and team = public.current_afc_team());

-- ── can_view_lead — re-derived from afc_users.role/committee/team
-- instead of lead_role_assignments. ─────────────────────────────────
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
        public.current_afc_role() in ('md', 'admin')
        or exists (
          select 1 from public.afc_users u
          where u.id = auth.uid() and u.team = l.team
        )
        or (
          l.status = 'dgm_review'
          and exists (
            select 1 from public.afc_users u
            where u.id = auth.uid() and u.committee = 'G3'
          )
        )
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.approval_authority_id, l.handled_by_dgm_id)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
