-- Admin can create a Business Partner's PMIS login directly (for BPs
-- already working with AFC), without an empanelment application. Such a
-- BP has no ba_registrations row, so its organisation name lives on the
-- user row: afc_users.bp_org_name. Every BP-name lookup prefers the
-- empanelment org name, then this, then the person's name.

alter table public.afc_users add column if not exists bp_org_name text;

create or replace function public.pmis_bp_org_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.org_name, nullif(btrim(u.bp_org_name), ''), u.full_name)
  from public.afc_users u
  left join public.empanelment_applications a on a.ba_user_id = u.id
  left join public.ba_registrations r on r.application_id = a.id
  where u.id = p_user_id
  order by a.created_at desc nulls last
  limit 1;
$$;

create or replace function public.get_empanelled_business_partners()
returns table(id uuid, org_name text, team text)
language sql
stable
security definer
set search_path = public
as $$
  select id, org_name, team from (
    select distinct on (u.id) u.id, coalesce(r.org_name, nullif(btrim(u.bp_org_name), ''), u.full_name) as org_name, u.team
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

create or replace function public.get_team_business_associates(p_team text)
returns table(id uuid, org_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (u.id) u.id, coalesce(r.org_name, nullif(btrim(u.bp_org_name), ''), u.full_name) as org_name
  from public.afc_users u
  left join public.empanelment_applications a on a.ba_user_id = u.id
  left join public.ba_registrations r on r.application_id = a.id
  where u.role = 'business_associate' and u.is_active = true and u.team = p_team
  order by u.id, a.created_at desc nulls last;
$$;
revoke all on function public.get_team_business_associates(text) from public;
grant execute on function public.get_team_business_associates(text) to authenticated;
