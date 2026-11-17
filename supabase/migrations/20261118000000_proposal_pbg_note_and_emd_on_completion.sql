-- Proposals money rework (2026-11-18):
--
--  1. EMD "On Completion" — an awarded proposal can now park its EMD until
--     the project is complete (track on_completion / status
--     awaiting_completion). No reminders run for it; the team can switch it
--     to EMD Refund at any time if the client returns the EMD mid-project,
--     and the normal refund flow takes over from there.
--  2. PBG Note (proposal_pbg_notes) — its own sign-off chain:
--       draft -> pending_ra -> pending_md -> pending_accounts
--             -> pending_payment -> completed ("PBG Done")
--     RA / MD / Accounts can each raise a Clarification Request, which
--     sends the note back to the team (draft) and remembers the stage in
--     return_to — the team's next forward goes straight back to that stage
--     instead of restarting at the RA.
--     The note's wording is chosen by the amounts: an EMD adjusted towards
--     the PBG (track "pbg") gives "remaining PBG = PBG - EMD"; otherwise
--     (refunded / on completion / no EMD) the full PBG is submitted.
--  3. Proof files: a "pbg_payment" purpose for the PBG payment proof, and
--     the Bid Payment Requisition Note's payment proof can now also be
--     uploaded by the lead's own team, not just Accounts.
--  4. Fee-note payment proof reminders: bookkeeping columns for the daily
--     sweep (proposal-finance-daily edge function, scheduled below).

-- ── Helper: the lead's own team on a proposal ───────────────────────
-- Person Responsible / Reviewer / Recommending Authority, any Additional
-- Responsible on the proposal, or MD/Admin.
create or replace function public.is_proposal_team_member(p_proposal_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_afc_role() in ('md', 'admin'), false)
    or exists (
      select 1
      from public.proposal_preparations pp
      join public.leads l on l.id = pp.lead_id
      where pp.id = p_proposal_id
        and auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id)
    )
    or exists (
      select 1 from public.proposal_additional_responsibles ar
      where ar.proposal_id = p_proposal_id and ar.user_id = auth.uid()
    );
$$;
revoke all on function public.is_proposal_team_member(uuid) from public;
grant execute on function public.is_proposal_team_member(uuid) to authenticated, service_role;

-- ── 1. EMD On Completion ────────────────────────────────────────────
alter table public.proposal_emd_tracking drop constraint if exists proposal_emd_tracking_track_check;
alter table public.proposal_emd_tracking add constraint proposal_emd_tracking_track_check
  check (track in ('refund', 'pbg', 'on_completion'));

alter table public.proposal_emd_tracking drop constraint if exists proposal_emd_tracking_status_check;
alter table public.proposal_emd_tracking add constraint proposal_emd_tracking_status_check
  check (status in ('draft', 'pending', 'received', 'pending_accounts', 'completed', 'awaiting_completion'));

alter table public.proposal_emd_tracking drop constraint if exists proposal_emd_tracking_status_per_track;
alter table public.proposal_emd_tracking add constraint proposal_emd_tracking_status_per_track check (
  (track = 'refund' and status in ('pending', 'received', 'pending_accounts', 'completed'))
  or (track = 'pbg' and status in ('draft', 'pending_accounts', 'completed'))
  or (track = 'on_completion' and status = 'awaiting_completion')
);

-- ── 2. PBG Note ─────────────────────────────────────────────────────
create table if not exists public.proposal_pbg_notes (
  id                    uuid primary key default gen_random_uuid(),
  proposal_id           uuid not null unique references public.proposal_preparations(id) on delete cascade,
  status                text not null default 'draft'
                        check (status in ('draft', 'pending_ra', 'pending_md', 'pending_accounts', 'pending_payment', 'completed')),
  pbg_amount            numeric(14, 2) not null check (pbg_amount > 0),
  consultancy_fee       numeric(14, 2) check (consultancy_fee is null or consultancy_fee > 0),
  -- EMD deposited on the approved Bid Payment Requisition Note, and how
  -- much of it is adjusted towards this PBG (the EMD only when the EMD
  -- track is "Converted to PBG", otherwise 0). Re-derived on every save
  -- and forward.
  emd_amount            numeric(14, 2) not null default 0 check (emd_amount >= 0),
  emd_adjusted          numeric(14, 2) not null default 0 check (emd_adjusted >= 0),
  -- Editable wording: { subject, paragraphs: {...}, enclosures, fields: {...} }.
  content               jsonb not null default '{}'::jsonb,
  remarks               text,
  -- Clarification Request bookkeeping.
  return_to             text check (return_to is null or return_to in ('pending_ra', 'pending_md', 'pending_accounts')),
  clarification_remark  text,
  clarification_by      uuid references public.afc_users(id) on delete set null,
  clarification_at      timestamptz,
  -- Signatures / steps.
  pr_signed_by          uuid references public.afc_users(id) on delete set null,
  pr_signed_at          timestamptz,
  ra_signed_by          uuid references public.afc_users(id) on delete set null,
  ra_signed_at          timestamptz,
  md_signed_by          uuid references public.afc_users(id) on delete set null,
  md_signed_at          timestamptz,
  accounts_reviewed_by  uuid references public.afc_users(id) on delete set null,
  accounts_reviewed_at  timestamptz,
  accounts_remark       text,
  payment_done_by       uuid references public.afc_users(id) on delete set null,
  payment_done_at       timestamptz,
  payment_reference     text,
  payment_remark        text,
  created_by            uuid references public.afc_users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.proposal_pbg_notes enable row level security;

drop policy if exists proposal_pbg_notes_select on public.proposal_pbg_notes;
create policy proposal_pbg_notes_select on public.proposal_pbg_notes
for select using (public.can_view_proposal(proposal_id));
-- No insert/update/delete policies: every change goes through the
-- proposal-pbg-note edge function (service role).

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'proposal_pbg_notes') then
    alter publication supabase_realtime add table public.proposal_pbg_notes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'proposal_finance_files') then
    alter publication supabase_realtime add table public.proposal_finance_files;
  end if;
end $$;

-- ── 3. Proof files ──────────────────────────────────────────────────
alter table public.proposal_finance_files drop constraint if exists proposal_finance_files_purpose_check;
alter table public.proposal_finance_files add constraint proposal_finance_files_purpose_check
  check (purpose in ('fee_payment', 'emd_refund', 'pbg', 'pbg_payment'));

alter table public.proposal_finance_events drop constraint if exists proposal_finance_events_scope_check;
alter table public.proposal_finance_events add constraint proposal_finance_events_scope_check
  check (scope in ('fee_payment', 'emd', 'pbg'));

-- Who may add/remove a proof right now:
--   fee_payment  — Accounts or the lead's team, while the approved note is unpaid
--   emd_refund   — the lead's team while the refund is "received"
--   pbg          — the lead's team while the PBG Note is a draft
--   pbg_payment  — Accounts or the lead's team while the PBG Note awaits payment
create or replace function public.can_manage_proposal_finance_file(p_proposal_id uuid, p_purpose text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case p_purpose
    when 'fee_payment' then
      (public.is_accounts_committee_member() or public.is_proposal_team_member(p_proposal_id))
      and exists (
        select 1 from public.fee_notes fn
        where fn.proposal_id = p_proposal_id and fn.status = 'approved' and fn.payment_status = 'pending'
      )
    when 'emd_refund' then
      public.is_proposal_team_member(p_proposal_id)
      and exists (
        select 1 from public.proposal_emd_tracking t
        where t.proposal_id = p_proposal_id and t.track = 'refund' and t.status = 'received'
      )
    when 'pbg' then
      public.is_proposal_team_member(p_proposal_id)
      and exists (
        select 1 from public.proposal_pbg_notes n
        where n.proposal_id = p_proposal_id and n.status = 'draft'
      )
    when 'pbg_payment' then
      (public.is_accounts_committee_member() or public.is_proposal_team_member(p_proposal_id))
      and exists (
        select 1 from public.proposal_pbg_notes n
        where n.proposal_id = p_proposal_id and n.status = 'pending_payment'
      )
    else false
  end;
$$;
revoke all on function public.can_manage_proposal_finance_file(uuid, text) from public;
grant execute on function public.can_manage_proposal_finance_file(uuid, text) to authenticated, service_role;

-- ── 4. Fee-note payment proof reminders ─────────────────────────────
alter table public.fee_notes
  add column if not exists proof_reminded_on date,
  add column if not exists proof_deadline_emailed_at timestamptz;

-- Daily sweep lives in the proposal-finance-daily edge function (it has
-- to send email, which SQL can't). pg_cron calls it through pg_net with a
-- shared secret; both the project URL and the secret come from Vault
-- ("project_url", "cron_secret") so no key is written into this file. If
-- either secret is missing the job is a no-op.
create extension if not exists pg_net;

create or replace function public.run_proposal_finance_daily()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise notice 'run_proposal_finance_daily: project_url / cron_secret missing from Vault — skipped';
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/proposal-finance-daily',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function public.run_proposal_finance_daily() from public;
grant execute on function public.run_proposal_finance_daily() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'proposal-finance-daily') then
    perform cron.unschedule('proposal-finance-daily');
  end if;
end $$;

-- 03:45 UTC = 09:15 IST.
select cron.schedule(
  'proposal-finance-daily',
  '45 3 * * *',
  $$select public.run_proposal_finance_daily();$$
);
