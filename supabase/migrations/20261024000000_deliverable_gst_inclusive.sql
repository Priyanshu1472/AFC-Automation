-- Whether a deliverable's recorded amount already includes GST. Default
-- false (GST excluded) matches every existing deliverable/milestone's
-- behavior today — their amount is, and stays, pre-GST. When true, the
-- invoice editor backs GST out of the figure instead of adding it on top
-- (see itemBaseAmount() in src/lib/monitoring.js), so the client is never
-- taxed twice on an amount that was always meant to be inclusive.
alter table public.monitoring_items add column gst_inclusive boolean not null default false;
