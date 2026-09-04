-- afc_user_teams was created with RLS enabled but no policies at all
-- (20260904000000) — the intent was "written only by service-role edge
-- functions", but that also silently blocked ordinary client-side reads:
-- AuthContext.fetchProfile() and EditUserPage both query this table
-- directly as the logged-in user, and got back an empty array every time,
-- even though the rows existed. Symptom: adding a second team to a DGM in
-- the admin form appeared to do nothing — the write succeeded, but the
-- DGM's own profile (and the admin's next edit-page load) couldn't see it.
--
-- Fix: let a user read their own team-membership rows, and let an Admin
-- read everyone's (needed for the Edit User form to show existing
-- assignments) — mirrors the existing afc_users_select_self /
-- afc_users_select_org_wide pattern.
create policy afc_user_teams_select_self on public.afc_user_teams
for select using (user_id = auth.uid());

create policy afc_user_teams_select_admin on public.afc_user_teams
for select using (public.current_afc_role() = 'admin');
