-- Manually added Business Partners.
--
-- Production has no BP who went through the PMIS empanelment flow yet, but
-- the company already works with BPs that were empanelled before PMIS. A
-- BP Source / Suo Moto lead couldn't be saved without picking one from
-- get_empanelled_business_partners(), so whoever adds a lead can now type
-- the BP's name instead. Each typed name is kept here (one row per
-- organisation, case-insensitive) so it shows up in the picker for every
-- later lead, and in the Empanelment module's "Manually Added" list.
--
-- These are names only — no afc_users account, so a manual BP never logs
-- in, never joins a lead/proposal chat, and never receives a BP invoice
-- request. leads.manual_ba_id is the counterpart of leads.assigned_ba_id;
-- a lead has at most one of the two.

create table if not exists public.manual_business_partners (
  id uuid primary key default gen_random_uuid(),
  org_name text not null check (length(btrim(org_name)) between 2 and 300),
  team text,
  created_by uuid references public.afc_users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists manual_business_partners_org_name_key
  on public.manual_business_partners (lower(btrim(org_name)));

alter table public.manual_business_partners enable row level security;

-- Read-only from the client for every staff role. Rows are only ever
-- inserted by create-lead/update-lead (service role), which dedupe by name.
drop policy if exists manual_business_partners_select on public.manual_business_partners;
create policy manual_business_partners_select on public.manual_business_partners
for select using (public.current_afc_role() != 'business_associate');

alter table public.leads
  add column if not exists manual_ba_id uuid references public.manual_business_partners(id);

alter table public.leads drop constraint if exists leads_one_business_partner;
alter table public.leads
  add constraint leads_one_business_partner check (assigned_ba_id is null or manual_ba_id is null);

create index if not exists leads_manual_ba_id_idx on public.leads (manual_ba_id);

-- The Empanelment module's "Manually Added" list: every manual BP, who
-- added it, and how many leads use it. security definer so the lead count
-- covers every team's leads, not just the ones the viewer can see.
create or replace function public.get_manual_business_partners()
returns table(id uuid, org_name text, team text, created_at timestamptz, created_by_name text, lead_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.org_name, m.team, m.created_at, u.full_name,
         (select count(*) from public.leads l where l.manual_ba_id = m.id)
  from public.manual_business_partners m
  left join public.afc_users u on u.id = m.created_by
  where public.current_afc_role() != 'business_associate'
  order by m.org_name;
$$;
revoke all on function public.get_manual_business_partners() from public;
grant execute on function public.get_manual_business_partners() to authenticated;
