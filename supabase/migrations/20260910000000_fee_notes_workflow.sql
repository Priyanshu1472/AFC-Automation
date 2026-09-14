-- Fee Notes: replace the 2-stage email-OTP flow (Person Responsible/Reviewer
-- submit -> MD approves) with a 3-stage sign-off chain — Person Responsible
-- -> Approval Authority -> MD — each stage signed with the actor's own
-- 4-digit action PIN (see supabase/functions/_shared/pin.ts, already used
-- across the Lead and Empanelment workflows) instead of an emailed code.
-- The three fee notes (EMD / Tender Fee / Processing Fee) are now also
-- auto-created when a proposal is first opened (create-proposal-
-- preparation) rather than manually "prepared" — see FeeNotesPanel.jsx.

alter table public.fee_notes
  add column payment_mode text,
  add column bp_sharing boolean not null default false,
  add column bp_share_amount numeric,
  add column pr_signed_by uuid references public.afc_users(id),
  add column pr_signed_at timestamptz,
  add column aa_signed_by uuid references public.afc_users(id),
  add column aa_signed_at timestamptz;

alter table public.fee_notes
  add constraint fee_notes_payment_mode_check
  check (payment_mode is null or payment_mode = any (array['online', 'bank_guarantee', 'demand_draft', 'bankers_cheque']));

-- Widen status for the new middle stage (pending_approval_authority).
alter table public.fee_notes drop constraint fee_notes_status_check;
alter table public.fee_notes add constraint fee_notes_status_check
  check (status = any (array['draft', 'pending_approval_authority', 'pending_md', 'approved', 'rejected']));

-- Widen the events vocabulary for the new stage transitions. 'submitted'/
-- 'resubmitted' (old: PR -> MD directly) are kept alongside the new values
-- rather than removed — existing rows already recorded under those actions
-- are a historical fact, not something to rewrite.
alter table public.fee_note_events drop constraint fee_note_events_action_check;
alter table public.fee_note_events add constraint fee_note_events_action_check
  check (action = any (array['submitted', 'resubmitted', 'forwarded_to_aa', 'forwarded_to_md', 'returned_by_aa', 'md_approved', 'md_rejected']));

-- Signing switched entirely to the PIN system — the emailed-OTP table is no
-- longer written to or read from (see request-fee-note-otp/feeNoteOtp.ts,
-- both deleted alongside this migration).
drop table if exists public.fee_note_otps;
