-- Sending an empanelment invite requires the Associate Consultant to pick
-- a Project Officer (and look up their team's DGM) from their own team,
-- but the existing afc_users RLS policies only allow: your own row, org-wide
-- read for md/cfo/cs, and a dgm reading their own team. No team-scoped role
-- could see anyone but themselves. Add a narrowly-scoped policy: any
-- authenticated user can see the active project_officer/dgm rows on their
-- own team — nothing else about teammates is exposed.
create policy afc_users_select_team_reviewers on public.afc_users
for select using (
  role in ('project_officer', 'dgm')
  and is_active = true
  and team = public.current_afc_team()
);
