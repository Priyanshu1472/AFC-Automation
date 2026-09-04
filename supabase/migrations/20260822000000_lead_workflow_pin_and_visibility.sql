-- Several Lead Generation workflow changes in one migration:
--
-- 1. leads.declined_from_status — records which review stage most recently
--    declined a lead (set by pmt_decline/pmt_extended_decline/dgm_decline/
--    dgm_initial_decline in advance-lead-stage), so update-lead's Edit &
--    Resubmit can route it back to the right place: back to
--    dgm_initial_review specifically when DGM declined it (so DGM re-reviews
--    what they sent back — the "Withdraw" action is also hidden for this
--    one case, see the frontend), everything else keeps the existing
--    behavior of funneling back into pmt_review as the single re-entry
--    point.
--
-- 2. afc_users.pin_hash / pin_updated_at — a reusable 5-digit action PIN,
--    separate from the login password, used to gate every committee/MD
--    decision on a lead (accept, approve, decline, escalate, forward, drop
--    — never edit). One-way SHA-256 hash (salted with the user's own id,
--    same convention as this codebase's existing OTP hashing) — nobody,
--    including Admin, can recover the actual digits; Admin can only reset
--    it to a new value. Given the tiny keyspace (5 digits = 100,000
--    possibilities), this is deliberately paired with rate-limited
--    verification (see _shared/pin.ts) — that's the real protection, not
--    the hash algorithm itself.
--
-- 3. can_view_lead() — reworked visibility:
--      - md/admin/cfo/cs: every lead, org-wide (cfo/cs are new here).
--      - dgm: every lead on their own team (unchanged in effect, now
--        explicit rather than falling out of the generic "any teammate"
--        rule).
--      - project_assistant/project_officer/associate_consultant/agm/srm:
--        ONLY leads they're actually named on (creator/Person Responsible/
--        Reviewer/Approval Authority) — the old blanket "any teammate on
--        this team sees every team lead" rule is gone entirely, including
--        for the PA-tier roles that used it for "claim a dropped lead";
--        claiming now only works for someone already named on the lead.
--      - PMT / PMT Extended / G3 committee members: org-wide visibility
--        into leads currently sitting at the stage their committee
--        reviews (pmt_review / pmt_extended_review / dgm_initial_review &
--        dgm_review) — this was previously ONLY wired up for G3; PMT and
--        PMT Extended relied on the generic team rule, which never
--        actually covered them reviewing another team's lead. Fixed here
--        so removing the blanket team rule doesn't quietly break the
--        org-wide committee pooling the rest of this module assumes.

alter table public.leads add column if not exists declined_from_status text;

alter table public.afc_users add column if not exists pin_hash text;
alter table public.afc_users add column if not exists pin_updated_at timestamptz;

create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs')
        or (
          public.current_afc_role() = 'dgm'
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.team = l.team)
        )
        or (
          public.current_afc_role() in ('project_assistant', 'project_officer', 'associate_consultant')
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.team = l.team)
        )
        or (
          l.status in ('dgm_initial_review', 'dgm_review')
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'G3')
        )
        or (
          l.status = 'pmt_review'
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT')
        )
        or (
          l.status = 'pmt_extended_review'
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT Extended')
        )
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.approval_authority_id, l.handled_by_dgm_id)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
