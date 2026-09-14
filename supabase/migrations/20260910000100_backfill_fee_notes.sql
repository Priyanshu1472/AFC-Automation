-- Backfill fee_notes for every proposal_preparations row created before
-- create-proposal-preparation started auto-creating all 3 note types on
-- open (20260910000000_fee_notes_workflow.sql) — otherwise those existing
-- proposals show an empty Fee Notes panel forever, since nothing calls the
-- insert-on-create path again for a proposal that already exists. Only
-- fills in whichever of EMD / Tender Fee / Processing Fee is actually
-- missing, so a proposal that already has one or more from the old
-- "Prepare Fee Notes" flow keeps that data untouched.

insert into public.fee_notes (proposal_id, note_type, created_by)
select pp.id, t.note_type, pp.created_by
from public.proposal_preparations pp
cross join (values ('emd'), ('tender_fee'), ('pbg')) as t(note_type)
where not exists (
  select 1 from public.fee_notes fn where fn.proposal_id = pp.id and fn.note_type = t.note_type
);
