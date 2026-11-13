-- Milestones now get the same treatment deliverables already got
-- (20261021000000): the "Raise a client invoice when completed" checkbox
-- is gone from the Add/Edit Milestone form — every milestone always alerts
-- the team to invoice on completion. Backfill existing milestones to match.
update public.monitoring_items set invoice_on_completion = true where kind = 'milestone' and invoice_on_completion = false;
