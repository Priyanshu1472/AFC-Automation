-- Adds a new lead status, po_assignment: the holding stage a lead created by
-- an Associate Consultant or Project Assistant lands in (no Person
-- Responsible/Reviewer/Recommending Authority set yet) until their team's
-- Project Officer (or Area Manager/Regional Manager, same permission tier)
-- assigns those three, PIN-confirmed, via advance-lead-stage's new
-- "po_assign" action — which then moves the lead into pa_review, the exact
-- status every other creator's lead already starts in today.
--
-- No RLS change needed: can_view_lead()'s existing
-- "person_responsible_id is null -> whole team can view" clause (added for
-- the lead-transfer flow) already covers this status, since po_assignment
-- leads always have a null person_responsible_id.
alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check check (status in (
  'po_assignment', 'pa_review', 'recommending_authority_review', 'pmt_review', 'md_review',
  'pa_action_required', 'pa_dropped', 'md_approved', 'md_declined'
));
