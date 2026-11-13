-- Once a lead reaches 'md_approved' (i.e. it's now a Proposal Preparation,
-- a terminal lead status — see leads_status_check), can_view_lead()'s
-- broader review-pipeline clauses (any DGM on the lead's team, any PMT/PMT
-- Extended/G3 committee member org-wide) kept applying, so staff who were
-- never assigned to that specific proposal could still see and open it —
-- e.g. a Reviewer's PMT committee membership let them see every other
-- team's approved proposals too, not just their own. Those clauses exist
-- for the earlier review pipeline (PA/DGM/PMT stages), where org-wide
-- committee visibility is intentional; they were never meant to carry into
-- Proposal Preparation, whose only actors are its own named Person
-- Responsible / Reviewer / Approval Authority (see canOpenProposal() in
-- src/lib/proposalPrep.js and every proposal edge function's own
-- authorization check — this migration just brings RLS in line with the
-- rule those already enforce).
--
-- md/admin/cfo/cs keep full visibility (unchanged, org-wide oversight
-- roles). The assigned Business Partner keeps their own narrow per-record
-- access (unchanged). `created_by` and `handled_by_dgm_id` — relevant
-- during the pre-approval review pipeline — no longer grant visibility
-- once a lead is md_approved unless that same person is also the named
-- Person Responsible/Reviewer/Approval Authority.

create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs')
        or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.approval_authority_id)
        or (
          l.status <> 'md_approved'
          and (
            (public.current_afc_role() = 'dgm' and public.is_current_user_team(l.team))
            or (
              l.status not in ('pa_review', 'pa_action_required', 'dgm_initial_review')
              and exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee in ('PMT', 'PMT Extended', 'G3'))
            )
            or auth.uid() in (l.created_by, l.handled_by_dgm_id)
          )
        )
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
