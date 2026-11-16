-- Proposals: Accounts Committee, fee payment, and EMD refund / PBG tracking.
--
--  1. Accounts Committee — a flag on afc_users (independent of the PMT/G3
--     `committee` column, so a member can also sit on PMT). Members see
--     every proposal whose Bid Payment Requisition Note the MD has approved,
--     and are the ones who make the payment and later verify the EMD
--     refund / PBG conversion.
--  2. fee_notes payment fields — once the MD approves the note, Accounts
--     checks the signatures and records the payment.
--  3. proposal_emd_tracking — what happens to the EMD after the client's
--     response: refunded (not awarded, or awarded and refunded) or
--     converted into the Performance Bank Guarantee (awarded). The lead's
--     team records it and forwards it; Accounts verifies it with a PIN.
--  4. proposal_finance_files — proofs for the payment / refund / PBG, in a
--     private "proposal-finance" bucket.
--  5. proposal_finance_events — history of every step above.
--  6. A daily sweep reminding the team every 14 days while an EMD refund
--     is still pending.
--
-- can_view_lead() and can_edit_proposal() are deliberately NOT redefined
-- here — Accounts visibility is added through separate, narrowly scoped
-- functions/policies instead.

-- ── 1. Accounts Committee flag ──────────────────────────────────────
alter table public.afc_users
  add column if not exists accounts_committee boolean not null default false;

create or replace function public.is_accounts_committee_member()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select u.accounts_committee from public.afc_users u where u.id = auth.uid() and u.is_active),
    false
  );
$$;

-- A proposal reaches Accounts once its Bid Payment Requisition Note is
-- approved by the MD.
create or replace function public.accounts_can_view_proposal(p_proposal_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_accounts_committee_member()
    and exists (
      select 1 from public.fee_notes fn
      where fn.proposal_id = p_proposal_id and fn.status = 'approved'
    );
$$;

create or replace function public.accounts_can_view_lead(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_accounts_committee_member()
    and exists (
      select 1
      from public.proposal_preparations pp
      join public.fee_notes fn on fn.proposal_id = pp.id
      where pp.lead_id = p_lead_id and fn.status = 'approved'
    );
$$;

-- Same body as the live definition, plus the Accounts clause. Every
-- proposal-prep SELECT policy (fee_notes, fee_note_events,
-- proposal_documents, ...) goes through this function.
create or replace function public.can_view_proposal(p_proposal_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.can_view_lead(pp.lead_id) or public.accounts_can_view_proposal(pp.id)
    from public.proposal_preparations pp
    where pp.id = p_proposal_id
  ), false);
$$;

drop policy if exists leads_select_accounts_committee on public.leads;
create policy leads_select_accounts_committee on public.leads
for select using (public.accounts_can_view_lead(id));

drop policy if exists proposal_preparations_select_accounts_committee on public.proposal_preparations;
create policy proposal_preparations_select_accounts_committee on public.proposal_preparations
for select using (public.accounts_can_view_proposal(id));

-- Names of the Person Responsible / Reviewer / RA / BP on the proposal page.
drop policy if exists afc_users_select_accounts_committee on public.afc_users;
create policy afc_users_select_accounts_committee on public.afc_users
for select using (is_active = true and public.is_accounts_committee_member());

revoke all on function public.is_accounts_committee_member() from public;
revoke all on function public.accounts_can_view_proposal(uuid) from public;
revoke all on function public.accounts_can_view_lead(uuid) from public;
grant execute on function public.is_accounts_committee_member() to authenticated, service_role;
grant execute on function public.accounts_can_view_proposal(uuid) to authenticated, service_role;
grant execute on function public.accounts_can_view_lead(uuid) to authenticated, service_role;

-- ── 2. Fee note payment by Accounts ─────────────────────────────────
alter table public.fee_notes
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_done_at timestamptz,
  add column if not exists payment_done_by uuid references public.afc_users(id) on delete set null,
  add column if not exists payment_reference text,
  add column if not exists payment_remark text;

alter table public.fee_notes drop constraint if exists fee_notes_payment_status_check;
alter table public.fee_notes add constraint fee_notes_payment_status_check
  check (payment_status in ('pending', 'paid'));

-- ── 3. EMD refund / PBG tracking ────────────────────────────────────
--   refund: pending (EMD not back yet) <-> received -> pending_accounts -> completed
--   pbg:    draft -> pending_accounts -> completed
-- Accounts sending it back returns it to received (refund) / draft (pbg).
create table if not exists public.proposal_emd_tracking (
  id               uuid primary key default gen_random_uuid(),
  proposal_id      uuid not null unique references public.proposal_preparations(id) on delete cascade,
  track            text not null check (track in ('refund', 'pbg')),
  status           text not null check (status in ('draft', 'pending', 'received', 'pending_accounts', 'completed')),
  emd_amount       numeric(14, 2) not null check (emd_amount >= 0),
  pbg_amount       numeric(14, 2) check (pbg_amount is null or pbg_amount > 0),
  remarks          text,
  received_at      timestamptz,
  forwarded_at     timestamptz,
  forwarded_by     uuid references public.afc_users(id) on delete set null,
  accounts_remark  text,
  completed_at     timestamptz,
  completed_by     uuid references public.afc_users(id) on delete set null,
  last_reminder_at timestamptz,
  created_by       uuid references public.afc_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint proposal_emd_tracking_status_per_track check (
    (track = 'refund' and status in ('pending', 'received', 'pending_accounts', 'completed'))
    or (track = 'pbg' and status in ('draft', 'pending_accounts', 'completed'))
  )
);

alter table public.proposal_emd_tracking enable row level security;

drop policy if exists proposal_emd_tracking_select on public.proposal_emd_tracking;
create policy proposal_emd_tracking_select on public.proposal_emd_tracking
for select using (public.can_view_proposal(proposal_id));
-- No insert/update/delete policies: every change goes through the
-- proposal-emd-action edge function (service role).

-- ── 4. Proof files ──────────────────────────────────────────────────
create table if not exists public.proposal_finance_files (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposal_preparations(id) on delete cascade,
  purpose      text not null check (purpose in ('fee_payment', 'emd_refund', 'pbg')),
  file_name    text not null,
  file_path    text not null unique,
  file_size    bigint,
  uploaded_by  uuid references public.afc_users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists proposal_finance_files_proposal_idx on public.proposal_finance_files(proposal_id, purpose);

-- Who may add/remove a proof right now:
--   fee_payment          — Accounts, while the approved note is unpaid
--   emd_refund           — the lead's PR/Reviewer/RA (or MD/Admin) while the refund is "received"
--   pbg                  — the same people while the PBG entry is a draft
create or replace function public.can_manage_proposal_finance_file(p_proposal_id uuid, p_purpose text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case p_purpose
    when 'fee_payment' then
      public.is_accounts_committee_member()
      and exists (
        select 1 from public.fee_notes fn
        where fn.proposal_id = p_proposal_id and fn.status = 'approved' and fn.payment_status = 'pending'
      )
    when 'emd_refund' then exists (
      select 1
      from public.proposal_emd_tracking t
      join public.proposal_preparations pp on pp.id = t.proposal_id
      join public.leads l on l.id = pp.lead_id
      where t.proposal_id = p_proposal_id and t.track = 'refund' and t.status = 'received'
        and (public.current_afc_role() in ('md', 'admin')
             or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id))
    )
    when 'pbg' then exists (
      select 1
      from public.proposal_emd_tracking t
      join public.proposal_preparations pp on pp.id = t.proposal_id
      join public.leads l on l.id = pp.lead_id
      where t.proposal_id = p_proposal_id and t.track = 'pbg' and t.status = 'draft'
        and (public.current_afc_role() in ('md', 'admin')
             or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id))
    )
    else false
  end;
$$;
revoke all on function public.can_manage_proposal_finance_file(uuid, text) from public;
grant execute on function public.can_manage_proposal_finance_file(uuid, text) to authenticated, service_role;

alter table public.proposal_finance_files enable row level security;

drop policy if exists proposal_finance_files_select on public.proposal_finance_files;
create policy proposal_finance_files_select on public.proposal_finance_files
for select using (public.can_view_proposal(proposal_id));

drop policy if exists proposal_finance_files_insert on public.proposal_finance_files;
create policy proposal_finance_files_insert on public.proposal_finance_files
for insert with check (
  uploaded_by = auth.uid()
  and split_part(file_path, '/', 1) = proposal_id::text
  and split_part(file_path, '/', 2) = purpose
  and public.can_manage_proposal_finance_file(proposal_id, purpose)
);

drop policy if exists proposal_finance_files_delete on public.proposal_finance_files;
create policy proposal_finance_files_delete on public.proposal_finance_files
for delete using (public.can_manage_proposal_finance_file(proposal_id, purpose));

insert into storage.buckets (id, name, public)
values ('proposal-finance', 'proposal-finance', false)
on conflict (id) do nothing;

-- Paths are "<proposal_id>/<purpose>/<file>".
drop policy if exists proposal_finance_storage_select on storage.objects;
create policy proposal_finance_storage_select on storage.objects
for select using (
  bucket_id = 'proposal-finance'
  and public.can_view_proposal((split_part(name, '/', 1))::uuid)
);

drop policy if exists proposal_finance_storage_insert on storage.objects;
create policy proposal_finance_storage_insert on storage.objects
for insert with check (
  bucket_id = 'proposal-finance'
  and public.current_afc_role() <> 'business_associate'
  and public.can_manage_proposal_finance_file((split_part(name, '/', 1))::uuid, split_part(name, '/', 2))
);

drop policy if exists proposal_finance_storage_delete on storage.objects;
create policy proposal_finance_storage_delete on storage.objects
for delete using (
  bucket_id = 'proposal-finance'
  and public.can_manage_proposal_finance_file((split_part(name, '/', 1))::uuid, split_part(name, '/', 2))
);

-- ── 5. History ──────────────────────────────────────────────────────
create table if not exists public.proposal_finance_events (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposal_preparations(id) on delete cascade,
  scope        text not null check (scope in ('fee_payment', 'emd')),
  action       text not null,
  remark       text,
  actor_id     uuid references public.afc_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists proposal_finance_events_proposal_idx on public.proposal_finance_events(proposal_id, created_at);

alter table public.proposal_finance_events enable row level security;
drop policy if exists proposal_finance_events_select on public.proposal_finance_events;
create policy proposal_finance_events_select on public.proposal_finance_events
for select using (public.can_view_proposal(proposal_id));

-- Live updates on the proposal page.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'proposal_emd_tracking') then
    alter publication supabase_realtime add table public.proposal_emd_tracking;
  end if;
end $$;

-- ── 6. EMD refund pending — reminder every 14 days ──────────────────
create or replace function public.notify_emd_refund_pending()
returns void
language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  for rec in
    select t.id, l.id as lead_id, l.lead_number, l.title,
           l.person_responsible_id, l.reviewer_id, l.recommending_authority_id
    from public.proposal_emd_tracking t
    join public.proposal_preparations pp on pp.id = t.proposal_id
    join public.leads l on l.id = pp.lead_id
    where t.track = 'refund'
      and t.status = 'pending'
      and coalesce(t.last_reminder_at, t.created_at) <= now() - interval '14 days'
  loop
    insert into public.notifications (user_id, title, sub_text, type, link, kind)
    select distinct uid,
      'EMD refund still pending',
      rec.lead_number || ' — "' || rec.title || '" is still waiting for its EMD to come back. Mark it Received and upload the proof once the client returns it.',
      'action_required',
      '/proposals/' || rec.lead_id,
      'proposal_emd'
    from unnest(array[rec.person_responsible_id, rec.reviewer_id, rec.recommending_authority_id]) as uid
    join public.afc_users u on u.id = uid and u.is_active
    where uid is not null;

    update public.proposal_emd_tracking set last_reminder_at = now() where id = rec.id;
  end loop;
end;
$$;

revoke all on function public.notify_emd_refund_pending() from public;
grant execute on function public.notify_emd_refund_pending() to service_role;

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-emd-refund-pending-daily') then
    perform cron.unschedule('notify-emd-refund-pending-daily');
  end if;
end $$;

-- 03:30 UTC = 09:00 IST.
select cron.schedule(
  'notify-emd-refund-pending-daily',
  '30 3 * * *',
  $$select public.notify_emd_refund_pending();$$
);
