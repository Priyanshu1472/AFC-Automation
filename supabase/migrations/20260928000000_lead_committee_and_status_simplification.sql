-- Simplifies the Lead Generation approval chain from PA -> DGM (initial) ->
-- PMT -> PMT Extended -> G3 -> MD down to PA -> Recommending Authority ->
-- PMT -> MD. PMT Extended and G3 (the DGM committee) are removed entirely —
-- product decision: too many stages in practice, and the org-wide G3 pool
-- never actually solved the Head Office problem (HO has AGMs but no DGM, so
-- a DGM-gated stage could never clear there) — see the companion
-- 20260928000100 migration, which turns the former dgm_initial_review stage
-- into a named-person gate instead of a team-DGM one, which is what
-- actually fixes that.

-- Any lead currently sitting at pmt_extended_review or dgm_review is
-- defensively moved back to pmt_review before the status check constraint
-- is tightened below — those two statuses are about to stop being valid,
-- and a lead there has already cleared PMT's own first look, so pmt_review
-- (to be re-decided under the simplified chain, no re-escalation option
-- left) is the correct landing spot, not an earlier or later stage.
do $$
declare
  moved_id uuid;
begin
  for moved_id in
    select id from public.leads where status in ('pmt_extended_review', 'dgm_review')
  loop
    insert into public.lead_activity_log (lead_id, actor_id, actor_role, action, from_status, to_status, comment)
    select moved_id, null, 'system', 'workflow_simplified',
      (select status from public.leads where id = moved_id), 'pmt_review',
      'Automatically moved back to PMT review — PMT Extended and G3 stages were removed from the approval chain.';

    update public.leads set status = 'pmt_review' where id = moved_id;
  end loop;
end $$;

-- The constraint has to come off before the rename below — it still only
-- allows the OLD status set at this point, so renaming a row to
-- 'recommending_authority_review' while it's still in force would violate
-- it immediately.
alter table public.leads drop constraint leads_status_check;

-- Existing 'dgm_initial_review' rows land on the renamed status.
update public.leads set status = 'recommending_authority_review' where status = 'dgm_initial_review';

alter table public.leads add constraint leads_status_check check (status in (
  'pa_review', 'recommending_authority_review', 'pmt_review', 'md_review',
  'pa_action_required', 'pa_dropped', 'md_approved', 'md_declined'
));

-- afc_users.committee: PMT Extended and G3 no longer mean anything —
-- clear the tag (role/team stay untouched) rather than silently
-- reinterpreting it as something else. Admin can manually re-add anyone to
-- PMT later if appropriate.
update public.afc_users set committee = null where committee in ('PMT Extended', 'G3');

alter table public.afc_users drop constraint if exists afc_users_committee_check;
alter table public.afc_users add constraint afc_users_committee_check check (committee is null or committee = 'PMT');
