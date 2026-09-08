-- proposal_preparations has row level security enabled but was missing its
-- SELECT policy entirely — RLS-enabled + zero policies means default-deny
-- for every role, including md/admin, even though can_view_lead() itself
-- evaluates correctly in isolation. This slipped through the
-- 20260820040000 reconciliation: that migration checked can_view_proposal()/
-- can_edit_proposal() and the policies on the six other proposal-prep
-- tables, but never actually confirmed this table had its own SELECT
-- policy — it silently had none, from whatever out-of-band push originally
-- created it. Symptom: the Proposal Preparation page crashed for every
-- user (including md) because the client-side proposal_preparations select
-- always came back empty, and ProposalPreparationPage.jsx dereferenced the
-- null result unconditionally.
create policy proposal_preparations_select on public.proposal_preparations
for select using (public.can_view_lead(lead_id));
