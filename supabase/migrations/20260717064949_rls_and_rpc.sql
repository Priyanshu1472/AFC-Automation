alter table public.afc_users enable row level security;

-- SECURITY DEFINER helpers bypass RLS internally so a policy on afc_users
-- can check the caller's own row without recursing into afc_users' own
-- policies (a plain subquery here would deadlock against itself).
create or replace function public.current_afc_role()
returns text
language sql stable security definer set search_path = public as $$
  select role from public.afc_users where id = auth.uid();
$$;

create or replace function public.current_afc_team()
returns text
language sql stable security definer set search_path = public as $$
  select team from public.afc_users where id = auth.uid();
$$;

-- Everyone can read their own row (needed for login/profile fetch).
create policy afc_users_select_self on public.afc_users
for select using (id = auth.uid());

-- md / cfo / cs: org-wide read access (reporting + oversight roles).
create policy afc_users_select_org_wide on public.afc_users
for select using (public.current_afc_role() in ('md', 'cfo', 'cs'));

-- dgm: read their own team's rows (their direct reports) in addition to self.
create policy afc_users_select_dgm_team on public.afc_users
for select using (
  public.current_afc_role() = 'dgm' and team = public.current_afc_team()
);

-- agm / srm / project_officer / associate_consultant: no extra policy, so
-- only afc_users_select_self applies — they can read exactly their own row.
-- No INSERT/UPDATE/DELETE policies exist for `authenticated` at all: every
-- write goes through the create-staff-user / set-user-status edge
-- functions using the service-role key.

create or replace function public.mark_password_changed()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.afc_users
  set must_change_password = false, updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.mark_password_changed() from public;
grant execute on function public.mark_password_changed() to authenticated;
