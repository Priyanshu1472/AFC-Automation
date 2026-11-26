-- md_declined is dead: advance-lead-stage's own md_decline action has
-- returned a lead to pa_action_required (not a terminal "declined" status)
-- since before this migration, so nothing has set this value in a long
-- time. The handful of leads still carrying it from that earlier behavior
-- were deleted (sample/test leads, no proposals or monitoring projects on
-- them) before this migration ran, so no existing row needs backfilling.

alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check check (
  status = any (array[
    'po_assignment', 'pa_review', 'recommending_authority_review', 'pmt_review',
    'g3_review', 'md_review', 'pa_action_required', 'pa_dropped', 'md_approved'
  ])
);
