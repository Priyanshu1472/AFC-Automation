create table public.afc_users (
  id                    uuid primary key references auth.users(id) on delete cascade,
  full_name             text not null,
  email                 text not null unique,
  role                  text not null check (role in
                          ('md','cfo','cs','dgm','agm','srm','project_officer','associate_consultant')),
  team                  text,
  office                text,
  is_active             boolean not null default true,
  must_change_password  boolean not null default true,
  created_by            uuid references auth.users(id),
  managed_by_dgm        uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Every role except md is expected to belong to an office; team is
  -- optional (cfo/cs are company-wide and have no team).
  constraint afc_users_office_required_check
    check (role = 'md' or office is not null)
);

create index afc_users_role_idx           on public.afc_users(role);
create index afc_users_team_idx           on public.afc_users(team);
create index afc_users_managed_by_dgm_idx on public.afc_users(managed_by_dgm);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger afc_users_set_updated_at
before update on public.afc_users
for each row execute function public.set_updated_at();
