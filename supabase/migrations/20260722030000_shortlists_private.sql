-- Shortlists were originally org-wide browsable (matching the reference
-- old project), but the user explicitly reversed that: a shortlist should
-- be fully private to its creator — nobody else, not even MD, can see,
-- add to, remove from, or delete another person's shortlist. Only the
-- create policy stays open to any non-BA staff (creating your OWN
-- shortlist is always fine); every other policy is now creator-only.

drop policy if exists shortlists_select on public.shortlists;
drop policy if exists shortlists_update on public.shortlists;
drop policy if exists shortlists_delete on public.shortlists;

create policy shortlists_select on public.shortlists
for select using (created_by = auth.uid());

create policy shortlists_update on public.shortlists
for update using (created_by = auth.uid());

create policy shortlists_delete on public.shortlists
for delete using (created_by = auth.uid());

drop policy if exists shortlist_projects_select on public.shortlist_projects;
drop policy if exists shortlist_projects_insert on public.shortlist_projects;
drop policy if exists shortlist_projects_update on public.shortlist_projects;
drop policy if exists shortlist_projects_delete on public.shortlist_projects;

create policy shortlist_projects_select on public.shortlist_projects
for select using (
  exists (select 1 from public.shortlists s where s.id = shortlist_id and s.created_by = auth.uid())
);
create policy shortlist_projects_insert on public.shortlist_projects
for insert with check (
  exists (select 1 from public.shortlists s where s.id = shortlist_id and s.created_by = auth.uid())
);
create policy shortlist_projects_update on public.shortlist_projects
for update using (
  exists (select 1 from public.shortlists s where s.id = shortlist_id and s.created_by = auth.uid())
);
create policy shortlist_projects_delete on public.shortlist_projects
for delete using (
  exists (select 1 from public.shortlists s where s.id = shortlist_id and s.created_by = auth.uid())
);
