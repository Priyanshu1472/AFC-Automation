-- Consortium/JV vs Independent (with BP Inputs) is chosen per Business
-- Partner, not once per lead. The first BP's choice stays in
-- leads.bp_association; every further BP carries its own in
-- lead_extra_business_partners.association. leads.bp_list is the ordered
-- [{ "name", "association" }] for pages and PDFs, kept by the same triggers
-- as leads.bp_names.

alter table public.lead_extra_business_partners
  add column if not exists association text;
alter table public.lead_extra_business_partners drop constraint if exists lead_extra_bp_association_check;
alter table public.lead_extra_business_partners
  add constraint lead_extra_bp_association_check
  check (association is null or association in ('consortium_jv', 'independent_bp_inputs'));

alter table public.leads add column if not exists bp_list jsonb;

create or replace function public.lead_bp_list(p_lead_id uuid, p_ba uuid, p_manual uuid, p_assoc text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_agg(jsonb_build_object('name', name, 'association', assoc) order by pos)
  from (
    select 0 as pos,
           coalesce(public.pmis_bp_org_name(p_ba), (select org_name from public.manual_business_partners where id = p_manual)) as name,
           p_assoc as assoc
    where p_ba is not null or p_manual is not null
    union all
    select e.position, coalesce(public.pmis_bp_org_name(e.ba_user_id), m.org_name), e.association
    from public.lead_extra_business_partners e
    left join public.manual_business_partners m on m.id = e.manual_ba_id
    where e.lead_id = p_lead_id
  ) x
  where name is not null;
$$;

create or replace function public.leads_set_bp_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.bp_names := public.lead_bp_names(new.id, new.assigned_ba_id, new.manual_ba_id);
  if new.assigned_ba_id is null and new.manual_ba_id is null then
    new.bp_association := null;
  end if;
  new.bp_list := public.lead_bp_list(new.id, new.assigned_ba_id, new.manual_ba_id, new.bp_association);
  return new;
end;
$$;

create or replace function public.lead_extra_bp_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid := coalesce(new.lead_id, old.lead_id);
begin
  update public.leads l
     set bp_names = public.lead_bp_names(l.id, l.assigned_ba_id, l.manual_ba_id),
         bp_list = public.lead_bp_list(l.id, l.assigned_ba_id, l.manual_ba_id, l.bp_association)
   where l.id = v_lead;
  return null;
end;
$$;

update public.leads
   set bp_list = public.lead_bp_list(id, assigned_ba_id, manual_ba_id, bp_association)
 where assigned_ba_id is not null or manual_ba_id is not null;
