-- Suo Moto lead type: same workflow as every other lead, just a different
-- intake form. Reuses existing columns where the concept already fits
-- (title = "Name of the Proposal", client_name = "Client/Ministry/
-- Department", submission_deadline = "Date of Submission") and adds the two
-- Suo-Moto-specific dates that don't map onto anything RFP/EOI already has.
-- `source = 'suo_moto'` was already anticipated in the leads table's CHECK
-- constraint since 20260818000000_lead_generation.sql — this just adds the
-- two missing columns and lets application code (leadEligibility.ts,
-- create-lead/update-lead) actually accept the value.

alter table public.leads add column if not exists presentation_date date;
alter table public.leads add column if not exists followup_date date;
