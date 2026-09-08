-- Person Responsible (PR) review gate on the Lead Approval Note. Tracked
-- entirely via two flags on the lead row — no new status value — so a lead
-- stays visibly "PA Review" (or "Action Required", if that's where it
-- started) throughout the whole creator-drafts -> PR reviews -> Accept/
-- Edit/Reject loop, exactly like every other same-status action already in
-- advance-lead-stage (see reject_reassign).
--
-- Why: the note's "Person Responsible" signature block was always stamped
-- with the PR's signature the instant the note PDF was (re)generated,
-- regardless of who actually filled the form — so if the lead's creator
-- filled it (not the PR), the PDF already showed the PR as having signed a
-- document they'd never actually seen. Now the PR's signature is only
-- embedded once approval_note_pr_reviewed is true, which only happens when
-- the PR themselves generates/edits the note, or explicitly Accepts a
-- draft the creator produced (see pr_review_accept in advance-lead-stage).
alter table public.leads add column if not exists approval_note_pr_reviewed boolean not null default false;

-- True while a creator-drafted note is sitting with the PR awaiting their
-- Accept/Edit/Reject — drives the Draft label and the PR's three-option
-- prompt on the lead page. Cleared (false) by pr_review_accept,
-- pr_review_reject, or simply the PR generating/editing the note directly.
alter table public.leads add column if not exists approval_note_pending_pr_review boolean not null default false;
