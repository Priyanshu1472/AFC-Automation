-- Two changes to Monitoring:
--
-- 1. Every monitoring alert (due-soon / overdue, invoice-to-raise on
--    completion, client payment received, BP invoice received) already
--    routes through notify_monitoring_team(), which reads its recipient
--    list from monitoring_team_ids(). That list was only ever the lead's
--    Person Responsible / Reviewer / Recommending Authority — widen it to
--    also include the lead's team's DGM and General Manager (matched the
--    same way team membership is checked everywhere else — primary team
--    or a secondary afc_user_teams row) and every active MD, org-wide.
--
-- 2. A milestone with deliverables now completes itself the moment its
--    last open deliverable is marked complete — no one has to remember to
--    go back and close the milestone by hand. Standalone deliverables
--    (no parent) and milestones with no deliverables are unaffected.

create or replace function public.monitoring_team_ids(p_project_id uuid)
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct u) filter (where u is not null), array[]::uuid[])
  from (
    select unnest(array[l.person_responsible_id, l.reviewer_id, l.recommending_authority_id]) as u
    from public.monitoring_projects mp
    join public.leads l on l.id = mp.lead_id
    where mp.id = p_project_id

    union all

    select au.id
    from public.monitoring_projects mp
    join public.leads l on l.id = mp.lead_id
    join public.afc_users au on au.is_active and (
      au.role = 'md'
      or (
        au.role in ('dgm', 'general_manager')
        and (au.team = l.team or exists (
          select 1 from public.afc_user_teams t where t.user_id = au.id and t.team = l.team
        ))
      )
    )
    where mp.id = p_project_id
  ) s(u);
$$;

create or replace function public.monitoring_auto_complete_milestone()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'deliverable' and new.status = 'completed' and old.status is distinct from 'completed' and new.parent_id is not null then
    if not exists (select 1 from public.monitoring_items where parent_id = new.parent_id and status <> 'completed') then
      update public.monitoring_items set status = 'completed' where id = new.parent_id and status <> 'completed';
    end if;
  end if;
  return new;
end;
$$;

create trigger monitoring_auto_complete_milestone
  after update of status on public.monitoring_items
  for each row execute function public.monitoring_auto_complete_milestone();
