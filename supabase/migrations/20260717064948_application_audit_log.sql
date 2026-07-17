create table public.application_audit_log (
  id             bigint generated always as identity primary key,
  action_by      uuid references auth.users(id),
  action_by_role text,
  action         text not null,
  comment        text,
  created_at     timestamptz not null default now()
);

alter table public.application_audit_log enable row level security;

-- No insert policy for `authenticated` — only service-role edge functions
-- write here. Only md/cfo/cs (oversight roles) can read it.
create policy audit_log_select_org_wide on public.application_audit_log
for select using (
  (select role from public.afc_users where id = auth.uid()) in ('md', 'cfo', 'cs')
);
