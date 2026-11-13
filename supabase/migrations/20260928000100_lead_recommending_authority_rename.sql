-- Renames leads.approval_authority_id -> recommending_authority_id. This
-- was always meant to be the actual first-line approver, not just an
-- informational contact — see the advance-lead-stage rewrite, which now
-- gates the recommending_authority_review stage on this exact person
-- (not "any DGM on the team"), and leadApprovalPdf.ts, which now draws
-- their signature on the note instead of a generic "Deputy General
-- Manager" slot. Renaming the column makes that the honest name.

alter table public.leads rename column approval_authority_id to recommending_authority_id;
alter index if exists leads_approval_authority_idx rename to leads_recommending_authority_idx;

-- Person Responsible / Reviewer / Recommending Authority were `not null`
-- because every lead always had all three from creation. A PMT-initiated
-- team transfer (see transfer-lead edge function) now needs a transient
-- state where a lead has moved to a new team but that team hasn't yet
-- named its own PR/Reviewer/Recommending Authority — the lead sits at
-- pa_review with these null until the new team's Edit Lead form (which
-- already requires all three before saving) fills them back in.
alter table public.leads alter column person_responsible_id drop not null;
alter table public.leads alter column reviewer_id drop not null;
alter table public.leads alter column recommending_authority_id drop not null;

-- Provenance for a transferred lead — surfaced read-only on the lead detail
-- page ("Transferred from Team X"). transfer_count is informational only,
-- not used for any gating logic.
alter table public.leads add column transferred_from_team text;
alter table public.leads add column transfer_count integer not null default 0;

-- can_edit_proposal() (20260820040000_proposal_preparation_schema.sql) is a
-- separate live function that also referenced the old column name directly
-- (not just can_view_lead, which is fully replaced in the next migration
-- anyway) — re-point it at the renamed column so it doesn't break the
-- instant the rename above takes effect.
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
        or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id)
      )
  );
$$;
