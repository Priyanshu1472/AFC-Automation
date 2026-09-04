-- Inserts a new DGM review stage right after PA acceptance, ahead of PMT —
-- product decision: PA accepts -> DGM (G3) reviews first -> PMT review ->
-- everything downstream of PMT (PMT Extended, the existing escalation-path
-- DGM/G3 review, MD review) stays exactly as it is today.
--
-- This is a distinct status from the existing 'dgm_review' (which stays
-- put — that one is the PMT-Extended escalation target, reached via
-- pmt_extended_forward_dgm and still resolving via dgm_accept/dgm_decline
-- straight to md_review). Reusing 'dgm_review' for this new, earlier stage
-- would collide: the same (from_status, action) pair in advance-lead-stage's
-- transition map can't point at two different destinations depending on
-- how the lead got there. Both stages are worked by the same G3 committee
-- (org-wide, same people), just at two different points in the pipeline.

alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check check (status in (
  'pa_review', 'dgm_initial_review', 'pmt_review', 'pmt_extended_review', 'dgm_review', 'md_review',
  'pa_action_required', 'pa_dropped', 'md_approved', 'md_declined'
));

-- can_view_lead — extend the G3-at-this-status visibility carve-out to the
-- new stage too, same rule as the existing one.
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
        public.current_afc_role() in ('md', 'admin')
        or exists (
          select 1 from public.afc_users u
          where u.id = auth.uid() and u.team = l.team
        )
        or (
          l.status in ('dgm_initial_review', 'dgm_review')
          and exists (
            select 1 from public.afc_users u
            where u.id = auth.uid() and u.committee = 'G3'
          )
        )
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.approval_authority_id, l.handled_by_dgm_id)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
