-- Two changes to the due-soon reminder added in
-- 20261105040000_lead_due_soon_reminder.sql:
--
-- 1. The MD / DGM-tier heads-up window widens from 2 days out to 3.
-- 2. A second, separate daily reminder: while a lead is still stuck at
--    PR Review or Recommending Authority review with its deadline a week
--    or less away, the three people actually named on it (Person
--    Responsible, Reviewer, Recommending Authority) get nudged every
--    single day the condition still holds, not once — unlike the MD/DGM
--    notice, this one has no "already notified" column, it's meant to
--    repeat until someone actually acts and the lead leaves that stage.

create or replace function public.notify_leads_due_soon()
returns void
language plpgsql security definer set search_path = public as $$
declare
  rec record;
  recipient_ids uuid[];
begin
  select array_agg(id) into recipient_ids
  from public.afc_users
  where is_active and role in ('md', 'dgm', 'general_manager', 'agm', 'srm');

  if recipient_ids is not null and array_length(recipient_ids, 1) is not null then
    -- Range, not an exact "deadline is in exactly 3 days" equality check, so
    -- a lead doesn't slip through silently if the sweep ever misses a day
    -- (downtime, a delayed first deploy, etc). due_soon_notified_for tracks
    -- the deadline value already notified for, so editing the lead to push
    -- the deadline out further re-arms the reminder for the new date, same
    -- idiom as isLeadOverdue()'s own "no stored status flag" approach.
    for rec in
      select id, lead_number, title
      from public.leads
      where status not in ('md_approved', 'md_declined', 'pa_dropped')
        and submission_deadline is not null
        and submission_deadline between current_date and current_date + 3
        and due_soon_notified_for is distinct from submission_deadline
    loop
      insert into public.notifications (user_id, title, sub_text, type, link)
      select
        uid,
        'Lead due in 3 days — no action taken',
        'No action has been taken on ' || rec.lead_number || ' ' || rec.title ||
          ' and it is available for claim, if any other team wants to pursue the lead. Raise a query on the lead or contact MD sir for the same.',
        'info',
        '/leads/' || rec.id
      from unnest(recipient_ids) as uid;

      update public.leads set due_soon_notified_for = submission_deadline where id = rec.id;
    end loop;
  end if;

  -- Daily, repeating reminder to the PR/Reviewer/Recommending Authority
  -- named on a lead that's still sitting at PR Review or Recommending
  -- Authority review with a week or less left on the clock. No dedup
  -- column — this fires again every day the sweep runs while the lead
  -- stays in one of those two statuses within the window, and stops the
  -- moment it moves on (or is dropped/declined/approved).
  for rec in
    select id, lead_number, person_responsible_id, reviewer_id, recommending_authority_id
    from public.leads
    where status in ('pa_review', 'recommending_authority_review')
      and submission_deadline is not null
      and submission_deadline between current_date and current_date + 7
  loop
    insert into public.notifications (user_id, title, sub_text, type, link)
    select
      uid,
      'Action required on ' || rec.lead_number,
      'Take required action on ' || rec.lead_number || '. Its submission deadline is within a week and no action has been taken yet.',
      'action_required',
      '/leads/' || rec.id
    from unnest(array[rec.person_responsible_id, rec.reviewer_id, rec.recommending_authority_id]) as uid
    where uid is not null;
  end loop;
end;
$$;
