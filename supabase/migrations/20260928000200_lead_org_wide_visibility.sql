-- Every earlier can_view_lead() rewrite scoped DGM/AGM/PMT visibility to
-- "your own team" or "only while the lead is at your committee's own
-- stage" — which meant another team's DGM/AGM had no way to even discover
-- that a lead existed, let alone notice a duplicate their own team was
-- about to start chasing independently. Product decision: DGM, AGM, and
-- PMT committee members now see every lead, org-wide, from creation
-- onward — the same blanket access md/admin/cfo/cs already had — so a
-- duplicate gets caught early instead of after two teams have both worked
-- it. This also lets PMT triage cross-team queries and initiate transfers
-- (see lead_queries / transfer-lead) without needing a lead named on them
-- first.
--
-- This collapses the last several migrations' layered narrowing
-- (team-DGM-only, status-gated-committee, not-after-md_approved, etc.)
-- into a much simpler rule — those clauses existed specifically to keep
-- DGM/PMT/PMT-Extended/G3 access narrow, which is no longer the goal.
-- srm is included alongside agm throughout, per this module's existing
-- convention (see src/lib/roles.js's LEAD_PA_TIER_ROLES comment) that srm
-- has the same access/permissions as agm everywhere in Lead Generation.
create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm')
        or exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT')
        -- Unchanged from every earlier version: the creator and named
        -- parties can always see their own lead, regardless of role —
        -- this matters for project_assistant/project_officer/
        -- associate_consultant, who aren't blanket org-wide above and may
        -- have created a lead they then assigned to a different teammate.
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.recommending_authority_id, l.handled_by_dgm_id)
        -- A transfer-lead (see 20260928000100/_shared/leadTransfer.ts) lands
        -- a lead on its new team with no Person Responsible yet — every
        -- other named-party clause above is now empty for that lead, so
        -- without this the whole team that was just notified about it
        -- ("assign a Person Responsible...") couldn't actually open it to
        -- do that. Scoped tightly to exactly that transient state.
        or (l.person_responsible_id is null and public.is_current_user_team(l.team))
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;
