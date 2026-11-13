-- Payment mode (and DD/instrument payee details) move from one field
-- shared by the whole Bid Payment Requisition Note to one per fee line —
-- EMD, Tender Fee, and Processing Fee can each be paid a different way
-- (e.g. EMD by Bank Guarantee, Processing Fee by Demand Draft). Also adds
-- "Fixed Deposit Receipt" as a payment mode.
--
-- No data to migrate — the table was only just recreated (20260911100000)
-- and every row in it is still a `draft` a Person Responsible is actively
-- filling in.

alter table public.fee_notes drop column payment_mode;
alter table public.fee_notes drop column dd_in_favour_of;
alter table public.fee_notes drop column dd_payable_at;

alter table public.fee_notes
  add column emd_payment_mode text,
  add column emd_dd_in_favour_of text,
  add column emd_dd_payable_at text,
  add column tender_fee_payment_mode text,
  add column tender_fee_dd_in_favour_of text,
  add column tender_fee_dd_payable_at text,
  add column processing_fee_payment_mode text,
  add column processing_fee_dd_in_favour_of text,
  add column processing_fee_dd_payable_at text;

alter table public.fee_notes add constraint fee_notes_emd_payment_mode_check
  check (emd_payment_mode is null or emd_payment_mode = any (array['online', 'bank_guarantee', 'demand_draft', 'bankers_cheque', 'fixed_deposit_receipt']));
alter table public.fee_notes add constraint fee_notes_tender_fee_payment_mode_check
  check (tender_fee_payment_mode is null or tender_fee_payment_mode = any (array['online', 'bank_guarantee', 'demand_draft', 'bankers_cheque', 'fixed_deposit_receipt']));
alter table public.fee_notes add constraint fee_notes_processing_fee_payment_mode_check
  check (processing_fee_payment_mode is null or processing_fee_payment_mode = any (array['online', 'bank_guarantee', 'demand_draft', 'bankers_cheque', 'fixed_deposit_receipt']));
