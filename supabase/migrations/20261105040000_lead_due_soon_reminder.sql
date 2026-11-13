-- No tier watches "the deadline is close and nothing has happened yet" on
-- its own — a lead can sit at PR Review or Recommending Authority review
-- right up to its submission deadline with no one above the owning team
-- ever finding out another team might want it. This adds a daily sweep
-- that reminds MD and every DGM-tier user (DGM, General Manager, AGM, SRM —
-- the same audience that already gets the org-wide "lead created" notice)
-- about any lead that's 2 days or less from its deadline and still not
-- resolved, so another team has a window to raise a Cross-Team Query
-- before it's too late.

alter table public.leads add column if not exists due_soon_notified_for date;

-- SECURITY DEFINER so it can insert into notifications for arbitrary
-- recipients the same way notifyUsers() does from the service-role client —
-- this runs from pg_cron, not a user session, so there's no caller to rely
-- on RLS for.
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

  if recipient_ids is null or array_length(recipient_ids, 1) is null then
    return;
  end if;

  -- Range, not an exact "deadline is in exactly 2 days" equality check, so
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
      and submission_deadline between current_date and current_date + 2
      and due_soon_notified_for is distinct from submission_deadline
  loop
    insert into public.notifications (user_id, title, sub_text, type, link)
    select
      uid,
      'Lead due in 2 days — no action taken',
      'No action has been taken on ' || rec.lead_number || ' ' || rec.title ||
        ' and it is available for claim, if any other team wants to pursue the lead. Raise a query on the lead or contact MD sir for the same.',
      'info',
      '/leads/' || rec.id
    from unnest(recipient_ids) as uid;

    update public.leads set due_soon_notified_for = submission_deadline where id = rec.id;
  end loop;
end;
$$;

revoke all on function public.notify_leads_due_soon() from public;
grant execute on function public.notify_leads_due_soon() to service_role;

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-leads-due-soon-daily') then
    perform cron.unschedule('notify-leads-due-soon-daily');
  end if;
end $$;

-- 03:00 UTC = 08:30 IST, ahead of the working day.
select cron.schedule(
  'notify-leads-due-soon-daily',
  '0 3 * * *',
  $$select public.notify_leads_due_soon();$$
);
