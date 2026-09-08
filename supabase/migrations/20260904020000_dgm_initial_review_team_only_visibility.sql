-- can_view_lead()'s org-wide committee clause (PMT/PMT Extended/G3) granted
-- visibility for every status except pa_review/pa_action_required — which
-- unintentionally included dgm_initial_review, the first-line team-DGM-only
-- gate (before the lead has actually reached the org-wide committee
-- pipeline at pmt_review). Since G3 committee membership is typically held
-- by every DGM (it's the DGM committee), this let ANY DGM view — and,
-- combined with a client-side predicate that only checked committee
-- membership, act-as-if-eligible for — a lead still sitting with a
-- different team's DGM, before PMT/G3 have any legitimate involvement.
--
-- Fix: exclude dgm_initial_review from the org-wide clause too. A lead at
-- that stage is visible only to: md/admin/cfo/cs (org-wide roles), the
-- lead's own team's DGM (is_current_user_team), and whoever's personally
-- named on it (creator/PR/reviewer/approval authority/assigned BA) — never
-- a DGM/committee member from another team.
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
          and public.is_current_user_team(l.team)
        )
        or (
          l.status not in ('pa_review', 'pa_action_required', 'dgm_initial_review')
          and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee in ('PMT', 'PMT Extended', 'G3'))
        )
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.approval_authority_id, l.handled_by_dgm_id)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
