-- Reverts 20261024000000_deliverable_gst_inclusive.sql — the GST
-- Included/Excluded toggle on Add Deliverable, and its effect on the
-- invoice editor, have been removed from the app at the user's request.
alter table public.monitoring_items drop column gst_inclusive;
