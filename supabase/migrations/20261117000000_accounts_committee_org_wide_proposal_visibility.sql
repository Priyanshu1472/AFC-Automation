-- Accounts Committee asked for full, org-wide visibility into every
-- proposal — not just the subset whose Bid Payment Requisition Note has
-- already been approved, which is all accounts_can_view_proposal()/
-- accounts_can_view_lead() granted previously (20261116000000). Same
-- visibility model PMT already has (committee membership alone, no
-- per-row condition).
--
-- Both functions keep their existing signature/name, since every policy
-- that gates on them (leads_select_accounts_committee,
-- proposal_preparations_select_accounts_committee, and — through
-- can_view_proposal() — fee_notes/proposal_documents/proposal_emd_tracking/
-- proposal_finance_files/proposal_finance_events and the proposal-finance
-- storage bucket) picks up the widened behaviour automatically.

create or replace function public.accounts_can_view_proposal(p_proposal_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_accounts_committee_member();
$$;

create or replace function public.accounts_can_view_lead(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_accounts_committee_member();
$$;
