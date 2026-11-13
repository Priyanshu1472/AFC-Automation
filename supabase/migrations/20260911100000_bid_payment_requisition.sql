-- Bid Payment Requisition Note — collapses the three separate fee notes
-- (EMD / Tender Fee / Processing Fee, one one-page PDF each) into ONE note
-- per proposal that carries whichever of the three fees apply and renders
-- as the real 2-page document: page 1 = covering "NOTE", page 2 = the
-- "Format for Requisition of Earnest Money Deposit (EMD) Amount" table.
--
-- The old per-type `fee_notes` shape (one row per (proposal, note_type),
-- single `amount`, `bp_sharing`/`bp_share_amount`) is dropped and rebuilt.
-- Staging held only disposable test rows — no backfill, per product call.
-- The code identifiers (`fee_notes`, `fee_note_events`, the fee-note edge
-- functions/routes) are deliberately kept; only the visible name changes,
-- same convention as the Business Partner rename.
--
-- Client Address / Telephone / Email are captured here (not on `leads`,
-- not on the Lead Approval Note — both of those modules are frozen). They
-- live as plain columns, not JSON, because the Knowledge Repository work
-- will read these client-contact details later.

drop table if exists public.fee_note_events cascade;
drop table if exists public.fee_notes cascade;

create table public.fee_notes (
  id                       uuid primary key default gen_random_uuid(),
  proposal_id              uuid not null unique references public.proposal_preparations(id) on delete cascade,

  -- One row, up to three fee lines. A null amount means that fee does not
  -- apply to this bid; borne_by says whether AFC or the assigned Business
  -- Partner funds it (the note's "M/s. … will be roped in" firm is always
  -- the lead's assigned BP).
  emd_amount               numeric,
  emd_borne_by             text not null default 'afc' check (emd_borne_by = any (array['afc', 'bp'])),
  tender_fee_amount        numeric,
  tender_fee_borne_by      text not null default 'afc' check (tender_fee_borne_by = any (array['afc', 'bp'])),
  processing_fee_amount    numeric,
  processing_fee_borne_by  text not null default 'afc' check (processing_fee_borne_by = any (array['afc', 'bp'])),

  payment_mode             text check (payment_mode is null or payment_mode = any (array['online', 'bank_guarantee', 'demand_draft', 'bankers_cheque'])),
  dd_in_favour_of          text,
  dd_payable_at            text,
  submit_to                text,

  client_address           text,
  client_telephone         text,
  client_email             text,

  implementation_arrangements text,
  justification            text,

  status                   text not null default 'draft'
                           check (status = any (array['draft', 'pending_approval_authority', 'pending_md', 'approved', 'rejected'])),

  pr_signed_by             uuid references public.afc_users(id),
  pr_signed_at             timestamptz,
  aa_signed_by             uuid references public.afc_users(id),
  aa_signed_at             timestamptz,
  md_decided_by            uuid references public.afc_users(id),
  md_decided_at            timestamptz,
  md_remark                text,

  created_by               uuid not null references public.afc_users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index fee_notes_status_idx on public.fee_notes(status);

create trigger fee_notes_set_updated_at
  before update on public.fee_notes
  for each row execute function public.set_updated_at();

create table public.fee_note_events (
  id            uuid primary key default gen_random_uuid(),
  fee_note_id   uuid not null references public.fee_notes(id) on delete cascade,
  actor_id      uuid references public.afc_users(id),
  actor_name    text,
  action        text not null
                check (action = any (array['forwarded_to_aa', 'returned_by_aa', 'forwarded_to_md', 'md_approved', 'md_rejected'])),
  remark        text,
  created_at    timestamptz not null default now()
);

create index fee_note_events_fee_note_idx on public.fee_note_events(fee_note_id, created_at);

-- RLS: reads gated by the same proposal-visibility predicate as every other
-- proposal child table; all writes go through the fee-note edge functions
-- on the service-role client, so there are no INSERT/UPDATE policies.
alter table public.fee_notes enable row level security;
alter table public.fee_note_events enable row level security;

create policy fee_notes_select on public.fee_notes
  for select using (public.can_view_proposal(proposal_id));

create policy fee_note_events_select on public.fee_note_events
  for select using (exists (
    select 1 from public.fee_notes fn
    where fn.id = fee_note_events.fee_note_id and public.can_view_proposal(fn.proposal_id)
  ));
