-- Extends the leads.approval_authority_id -> recommending_authority_id
-- rename (20260928000100) to the Bid Payment Requisition Note's own,
-- separate "Approval Authority" surface — for full naming consistency now
-- that the underlying person is called Recommending Authority everywhere
-- else. fee_notes/fee_note_events are still live with a handful of rows
-- (2 fee notes at pending_approval_authority, 4 forwarded_to_aa events, 1
-- returned_by_aa event as of this writing) — data-migrated below, not just
-- the check constraints.

-- Constraints have to come off before the data-migration UPDATEs below —
-- they still only allow the OLD values at this point, so renaming a row to
-- e.g. 'pending_recommending_authority' while the old constraint is still
-- in force would violate it immediately (see the sibling lead-status
-- migration, which hit the exact same ordering bug first).
alter table public.fee_notes drop constraint fee_notes_status_check;
alter table public.fee_note_events drop constraint fee_note_events_action_check;

update public.fee_notes set status = 'pending_recommending_authority' where status = 'pending_approval_authority';
update public.fee_note_events set action = 'forwarded_to_ra' where action = 'forwarded_to_aa';
update public.fee_note_events set action = 'returned_by_ra' where action = 'returned_by_aa';

alter table public.fee_notes rename column aa_signed_by to ra_signed_by;
alter table public.fee_notes rename column aa_signed_at to ra_signed_at;

alter table public.fee_notes add constraint fee_notes_status_check
  check (status = any (array['draft', 'pending_recommending_authority', 'pending_md', 'approved', 'rejected']));

alter table public.fee_note_events add constraint fee_note_events_action_check
  check (action = any (array['forwarded_to_ra', 'returned_by_ra', 'forwarded_to_md', 'md_approved', 'md_rejected']));

-- can_view_proposal() itself doesn't reference any of the renamed
-- columns/values (it only reads proposal_preparations/leads' own named
-- party columns, already re-pointed in 20260928000100's can_edit_proposal
-- rename), so it needs no change here.
