-- Multi-committee support: a user can now hold more than one Lead
-- Generation / Proposals committee at once (e.g. PMT and Accounts).
-- Mirrors afc_user_teams exactly: afc_users.committee stays the scalar
-- "primary" committee for backward compatibility with any code still
-- reading it directly; afc_user_committees is the authoritative
-- multi-value set every permission check now goes through.
--
-- This also retires the separate accounts_committee boolean flag added in
-- 20261116000000_proposal_accounts_committee_and_emd.sql — Accounts
-- Committee membership is now just "Accounts" in this same committee set,
-- not a second, independent toggle with its own dropdown.

create table public.afc_user_committees (
  user_id    uuid not null references public.afc_users(id) on delete cascade,
  committee  text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, committee)
);

create index afc_user_committees_user_idx on public.afc_user_committees(user_id);

alter table public.afc_user_committees enable row level security;

-- Same shape as afc_user_teams_select_self/afc_user_teams_select_admin —
-- a user reads their own committee rows, Admin reads everyone's (needed
-- for the Edit User form to show existing assignments). No insert/update/
-- delete policies: written only by create-staff-user/update-staff-user via
-- the service-role key.
create policy afc_user_committees_select_self on public.afc_user_committees
for select using (user_id = auth.uid());

create policy afc_user_committees_select_admin on public.afc_user_committees
for select using (public.current_afc_role() = 'admin');

-- Backfill from the existing scalar committee...
insert into public.afc_user_committees (user_id, committee)
select id, committee from public.afc_users where committee is not null
on conflict (user_id, committee) do nothing;

-- ...and from the accounts_committee boolean, before it's dropped below —
-- an existing Accounts Committee member keeps that membership, now
-- represented the same way as every other committee.
insert into public.afc_user_committees (user_id, committee)
select id, 'Accounts' from public.afc_users where accounts_committee = true
on conflict (user_id, committee) do nothing;

-- Re-point is_accounts_committee_member() at the committee set instead of
-- the boolean column — every RLS policy that calls it (afc_users_select_
-- accounts_committee, accounts_can_view_proposal, accounts_can_view_lead)
-- picks this up automatically.
create or replace function public.is_accounts_committee_member()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.afc_user_committees c
    join public.afc_users u on u.id = c.user_id
    where c.user_id = auth.uid() and c.committee = 'Accounts' and u.is_active
  );
$$;

alter table public.afc_users drop column accounts_committee;

-- Widen the committee check constraint to allow 'Accounts' — this never
-- actually reached this database (20261112010000, which first tried this,
-- was superseded before it was ever deployed).
alter table public.afc_users drop constraint if exists afc_users_committee_check;
alter table public.afc_users add constraint afc_users_committee_check
  check (committee is null or committee in ('PMT', 'G3', 'Accounts'));
