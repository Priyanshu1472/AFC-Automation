-- afc_users_select_own_team_active (last touched 20260904000000) only ever
-- exposed a target row to callers on the SAME team, or when either party
-- was a committee member — written back when only committee members had
-- any cross-team reach at all. Now that DGM/AGM/PMT have org-wide LEAD
-- visibility (20260928000200), the exact same "join comes back null" bug
-- that 20260820000000 originally fixed for committees reappears for them:
-- a DGM viewing another team's lead can see the lead row itself, but the
-- name-joins on it (creator:created_by(full_name), assignee:
-- person_responsible_id(full_name), etc. — see LeadListPage/
-- LeadDetailPage) silently come back null, because this policy still only
-- grants afc_users read within the caller's own team.
--
-- Widened to match can_view_lead()'s own org-wide roles exactly — md,
-- admin, cfo, cs, dgm, agm, srm all get org-wide afc_users read now, same
-- as a PMT committee member already had. The dead 'PMT Extended'/'G3'
-- committee values are dropped along with this (afc_users.committee can
-- only be 'PMT' or null now, see 20260928000000).
drop policy if exists afc_users_select_own_team_active on public.afc_users;
create policy afc_users_select_own_team_active on public.afc_users
for select using (
  is_active = true
  and (
    public.is_current_user_team(team)
    or committee = 'PMT'
    or public.current_afc_committee() = 'PMT'
    or public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm')
  )
);
