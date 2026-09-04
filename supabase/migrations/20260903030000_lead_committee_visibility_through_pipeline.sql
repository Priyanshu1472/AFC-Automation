-- can_view_lead() — committee visibility was scoped to the exact single
-- status each committee reviews (PMT only at pmt_review, PMT Extended only
-- at pmt_extended_review, G3 only at dgm_initial_review/dgm_review), so
-- the moment a lead moved to the *next* stage, whichever committee had
-- just cleared it lost all visibility into it — unless one of their own
-- members happened to also be personally named on the lead (creator/PR/
-- reviewer/approval authority/handling DGM). Reported symptom: a PMT (or
-- PMT Extended/G3) member sees "No leads found" for a lead they reviewed
-- and forwarded on, the instant it advances past their own stage.
--
-- Fix: PMT/PMT Extended/G3 are one pool of org-wide review committees —
-- once a lead has been cleared by DGM into that pipeline, any of them can
-- track it all the way through to MD's decision or a drop, not just while
-- it happens to sit at their own specific stage. Only pa_review and
-- pa_action_required (the PA-tier-only stages, before/between committee
-- involvement) stay excluded.
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
          l.status not in ('pa_review', 'pa_action_required')
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee in ('PMT', 'PMT Extended', 'G3'))
        )
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.approval_authority_id, l.handled_by_dgm_id)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
