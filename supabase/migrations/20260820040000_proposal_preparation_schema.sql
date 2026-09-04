-- Proposal Preparation module: fee notes (EMD / Tender Fee / PBG) with
-- OTP-gated MD approval, a BA document-requirement list, an internal AFC
-- checklist, three proposal document slots, and a lock + client-outcome
-- step. Attaches directly to `leads` (one row per approved lead) — there
-- is deliberately no separate "project" entity. Reached via "Open Proposal"
-- once a lead's status is 'md_approved' (see create-proposal-preparation/
-- index.ts, called lazily on first visit).
--
-- This is a RECONCILIATION migration, not a from-scratch one: every table,
-- RLS policy, function, and the storage bucket for this module were
-- already pushed directly to the shared afc-automation-dev database
-- outside git (same thing that happened with the old Lead Generation
-- module before it was rebuilt in-house — see 20260817030000). git had no
-- record of any of it. What's actually broken, and what this migration
-- fixes:
--
--   1. proposal_preparations.lead_id had no FK to leads(id) — it was
--      silently dropped when the old `leads` table was rebuilt
--      (20260817030000 / 20260818000000), since the old push predates that
--      rebuild and nothing re-pointed it.
--   2. can_edit_proposal() still read l.last_date, a column that no longer
--      exists on the new leads schema (it's submission_deadline now) —
--      this function was returning a query error, not just a wrong
--      answer, on live traffic.
--   3. Two orphaned proposal_preparations rows (and their fee_notes) from
--      that old push referenced lead ids that no longer exist post-rebuild
--      — draft-only test data, deleted here so the FK can be restored.
--
-- Everything else (table shapes, indexes, triggers, can_view_proposal(),
-- every RLS policy, the proposal-documents storage bucket + its two
-- storage.objects policies) was already deployed correctly and is left
-- untouched — re-declaring it here would just fail on "already exists".

-- ── Clear orphaned test data so the FK below can be added ──────────
delete from public.proposal_preparations
where lead_id not in (select id from public.leads);
-- fee_notes/fee_note_events/proposal_document_requests/
-- proposal_afc_checklist_items/proposal_documents all cascade off
-- proposal_preparations(id) — confirmed empty for these two rows before
-- this migration was written.

-- ── Restore the FK that got dropped in the leads rebuild ───────────
alter table public.proposal_preparations
  add constraint proposal_preparations_lead_id_fkey
  foreign key (lead_id) references public.leads(id);

-- ── Re-point can_edit_proposal() at the current leads schema ───────
create or replace function public.can_edit_proposal(p_proposal_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.proposal_preparations pp
    join public.leads l on l.id = pp.lead_id
    where pp.id = p_proposal_id
      and not pp.locked
      and (l.submission_deadline is null or l.submission_deadline >= current_date)
      and (
        public.current_afc_role() in ('md', 'admin')
        or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.approval_authority_id)
      )
  );
$$;
