-- A correction should resume review at the stage that raised the hold, not
-- unconditionally restart the whole pipeline at po_review — otherwise a hold
-- raised at po_final_review (after CFO/CS already reviewed) forces a second,
-- redundant CFO/CS pass, and worse, leaves their stale cfo_reviewed/
-- cs_reviewed flags in place, deadlocking the fan-in in advance-empanelment-
-- stage (both show "already reviewed" and neither can act).
alter table public.empanelment_applications
  add column hold_origin_status text;
