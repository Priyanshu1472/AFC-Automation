-- A lead can now be linked to an empanelled Business Partner from ANY team,
-- not just the lead's own team — whoever adds a lead sees the full,
-- searchable list of empanelled BPs. Same shape/sensitivity as
-- get_team_business_associates (id + organisation name), plus the BP's home
-- team so the picker can show it. That RPC is kept for older clients.
create or replace function public.get_empanelled_business_partners()
returns table(id uuid, org_name text, team text)
language sql
stable
security definer
set search_path = public
as $$
  select id, org_name, team from (
    select distinct on (u.id) u.id, coalesce(r.org_name, u.full_name) as org_name, u.team
    from public.afc_users u
    left join public.empanelment_applications a on a.ba_user_id = u.id
    left join public.ba_registrations r on r.application_id = a.id
    where u.role = 'business_associate' and u.is_active = true
    order by u.id, a.created_at desc nulls last
  ) bp
  order by org_name;
$$;
revoke all on function public.get_empanelled_business_partners() from public;
grant execute on function public.get_empanelled_business_partners() to authenticated;
