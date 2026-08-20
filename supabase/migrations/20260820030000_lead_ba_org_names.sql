-- The Lead Form's Business Associate dropdown was showing afc_users.full_name
-- (the BA portal account's contact-person name, per provisionBaAccount) —
-- product wants the organisation name instead, sourced from the Empanelment
-- module's own ba_registrations.org_name (the field shown in the
-- Empanelment Applications table's "Organisation" column). Regular lead
-- users have no RLS access to empanelment_applications/ba_registrations
-- (gated by can_view_empanelment_application), so this is a narrow
-- SECURITY DEFINER RPC exposing only id + org_name for active BAs on one
-- team — the same pattern as find_similar_leads.
--
-- A BA can have more than one empanelment_applications row referencing the
-- same ba_user_id (e.g. re-applying under the same email) — distinct on
-- picks the most recent application's org_name.
create or replace function public.get_team_business_associates(p_team text)
returns table(id uuid, org_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (u.id) u.id, coalesce(r.org_name, u.full_name) as org_name
  from public.afc_users u
  left join public.empanelment_applications a on a.ba_user_id = u.id
  left join public.ba_registrations r on r.application_id = a.id
  where u.role = 'business_associate' and u.is_active = true and u.team = p_team
  order by u.id, a.created_at desc nulls last;
$$;

revoke all on function public.get_team_business_associates(text) from public;
grant execute on function public.get_team_business_associates(text) to authenticated;
