-- A lead can name more than one Business Partner, and says how the BP(s)
-- are involved: "Consortium/JV" or "Independent (with BP Inputs)".
--
-- The first BP stays in leads.assigned_ba_id / leads.manual_ba_id exactly
-- as before, so everything keyed on "the lead's BP" (proposal chat, BP
-- document requests, BP invoices, fee/PBG notes) keeps working unchanged.
-- Every further BP goes in lead_extra_business_partners, in the order
-- picked. leads.bp_names is the display string for all of them, joined
-- with " & " ("A & B & C"), kept current by triggers so every page and PDF
-- can just print it.

alter table public.leads
  add column if not exists bp_association text,
  add column if not exists bp_names text;

alter table public.leads drop constraint if exists leads_bp_association_check;
alter table public.leads
  add constraint leads_bp_association_check
  check (bp_association is null or bp_association in ('consortium_jv', 'independent_bp_inputs'));

create table if not exists public.lead_extra_business_partners (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  position int not null check (position >= 1),
  ba_user_id uuid references public.afc_users(id),
  manual_ba_id uuid references public.manual_business_partners(id),
  created_at timestamptz not null default now(),
  constraint lead_extra_bp_one_kind check (num_nonnulls(ba_user_id, manual_ba_id) = 1),
  unique (lead_id, position)
);
create unique index if not exists lead_extra_bp_user_key on public.lead_extra_business_partners (lead_id, ba_user_id) where ba_user_id is not null;
create unique index if not exists lead_extra_bp_manual_key on public.lead_extra_business_partners (lead_id, manual_ba_id) where manual_ba_id is not null;
create index if not exists lead_extra_bp_manual_idx on public.lead_extra_business_partners (manual_ba_id);

alter table public.lead_extra_business_partners enable row level security;
drop policy if exists lead_extra_bp_select on public.lead_extra_business_partners;
create policy lead_extra_bp_select on public.lead_extra_business_partners
for select using (public.can_view_lead(lead_id));
-- Written only by create-lead / update-lead (service role).

-- Organisation name of a BP on PMIS (same source as the lead form's picker).
create or replace function public.pmis_bp_org_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.org_name, u.full_name)
  from public.afc_users u
  left join public.empanelment_applications a on a.ba_user_id = u.id
  left join public.ba_registrations r on r.application_id = a.id
  where u.id = p_user_id
  order by a.created_at desc nulls last
  limit 1;
$$;

-- "A & B & C": the first BP, then every extra one in order.
create or replace function public.lead_bp_names(p_lead_id uuid, p_ba uuid, p_manual uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(string_agg(name, ' & ' order by pos), '')
  from (
    select 0 as pos, coalesce(public.pmis_bp_org_name(p_ba), (select org_name from public.manual_business_partners where id = p_manual)) as name
    where p_ba is not null or p_manual is not null
    union all
    select e.position, coalesce(public.pmis_bp_org_name(e.ba_user_id), m.org_name)
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
  if new.bp_names is null then
    new.bp_association := null;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_bp_names on public.leads;
create trigger leads_bp_names
  before insert or update of assigned_ba_id, manual_ba_id, bp_association on public.leads
  for each row execute function public.leads_set_bp_names();

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
     set bp_names = public.lead_bp_names(l.id, l.assigned_ba_id, l.manual_ba_id)
   where l.id = v_lead;
  return null;
end;
$$;

drop trigger if exists lead_extra_bp_names on public.lead_extra_business_partners;
create trigger lead_extra_bp_names
  after insert or update or delete on public.lead_extra_business_partners
  for each row execute function public.lead_extra_bp_changed();

-- Backfill the display string for every existing lead with a BP.
update public.leads
   set bp_names = public.lead_bp_names(id, assigned_ba_id, manual_ba_id)
 where assigned_ba_id is not null or manual_ba_id is not null;

-- The Manually Added list's lead count includes leads naming the BP as an
-- extra partner too.
create or replace function public.get_manual_business_partners()
returns table(id uuid, org_name text, team text, created_at timestamptz, created_by_name text, lead_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.org_name, m.team, m.created_at, u.full_name,
         (select count(*) from public.leads l
           where l.manual_ba_id = m.id
              or exists (select 1 from public.lead_extra_business_partners e where e.lead_id = l.id and e.manual_ba_id = m.id))
  from public.manual_business_partners m
  left join public.afc_users u on u.id = m.created_by
  where public.current_afc_role() != 'business_associate'
  order by m.org_name;
$$;
