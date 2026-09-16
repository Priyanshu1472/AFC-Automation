-- Add "Client Type" (Government / Private) and "Project Status"
-- (Ongoing / Completed) as structured, filterable columns on projects —
-- both optional, set from the Add/Edit Project forms in the Knowledge
-- Repository.
alter table public.projects
  add column client_type text check (client_type in ('Government', 'Private')),
  add column status text check (status in ('Ongoing', 'Completed'));
