-- "Add User" (additional Person Responsible) is only meaningful while the
-- lead is still with the PR — pa_review (first pass) or pa_action_required
-- (sent back for rework by the Recommending Authority, PMT, or MD). Once
-- it clears Recommending Authority review and moves on, the team roster is
-- considered locked in; a later decline that returns it to
-- pa_action_required re-opens the window again, same as every other
-- PR-only action already works. Previously this only excluded the two
-- dead-end statuses (pa_dropped/md_declined), leaving it open the whole
-- way through recommending_authority_review/pmt_review/g3_review/
-- md_review/md_approved too.
create or replace function public.can_manage_lead_responsibles(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and l.status in ('pa_review', 'pa_action_required')
      and (
        public.current_afc_role() in ('md', 'admin')
        or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id)
        or exists (
          select 1 from public.lead_additional_responsibles x
          where x.lead_id = l.id and x.user_id = auth.uid()
        )
      )
  );
$$;
