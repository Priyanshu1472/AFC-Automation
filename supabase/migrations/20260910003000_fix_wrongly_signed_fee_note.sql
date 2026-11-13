-- Data fix for the one fee note that got signed through the md/admin
-- override just removed from advance-fee-note-stage/decide-fee-note-md:
-- AFC/TEAM 1/L/26/013's EMD note was forwarded-as-Approval-Authority AND
-- approved-as-MD by the same MD account, bypassing the lead's actual
-- Approval Authority (its DGM) entirely — printing the MD's name under
-- both the "Approval Authority" and "Managing Director" signature columns.
-- Resets it to pending_approval_authority so the real Approval Authority
-- can review and forward it properly; Person Responsible's own (legitimate)
-- signature is left untouched.
update public.fee_notes
set status = 'pending_approval_authority',
    aa_signed_by = null,
    aa_signed_at = null,
    md_decided_by = null,
    md_decided_at = null,
    md_remark = null
where id = '76e7f3b8-8d2c-43a4-b858-b0c4433c1579';

insert into public.fee_note_events (fee_note_id, actor_id, actor_name, action, remark)
values (
  '76e7f3b8-8d2c-43a4-b858-b0c4433c1579',
  null,
  'System',
  'returned_by_aa',
  'Corrected: this note had been forwarded and approved via an admin override that bypassed the lead''s actual Approval Authority. Reset to pending Approval Authority review.'
);
