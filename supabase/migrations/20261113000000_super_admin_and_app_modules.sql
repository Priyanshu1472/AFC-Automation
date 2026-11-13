-- Go-live: Super Admin role + module ON/OFF switch (docs/GO-LIVE-PLAN.md).
--
-- super_admin: one owner account, created directly in the database (never
-- pickable in Create/Edit User). Deliberately NOT added to any existing
-- RLS policy or permission list, so it sees no business data — its only
-- power is switching modules ON/OFF in app_modules below.
--
-- app_modules: one row per module. Read by everyone (including the public
-- BP form / status pages, which follow the Empanelment switch); written
-- only by an active super_admin. Staging ignores it (every module is
-- always ON there — see src/lib/modules.js and _shared/modules.ts); it
-- only takes effect where VITE_APP_ENV / APP_ENV = production.

-- ── afc_users role check: add super_admin ───────────────────────────
alter table public.afc_users drop constraint afc_users_role_check;
alter table public.afc_users add constraint afc_users_role_check
  check (role in (
    'md','cfo','cs','dgm','agm','srm','project_officer','associate_consultant',
    'project_assistant','business_associate','admin',
    'area_manager','regional_manager','general_manager','executive_director',
    'super_admin'
  ));

-- Super Admin isn't tied to an office.
alter table public.afc_users drop constraint afc_users_office_required_check;
alter table public.afc_users add constraint afc_users_office_required_check
  check (role in ('md', 'business_associate', 'super_admin') or office is not null);

create or replace function public.is_active_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.afc_users
    where id = auth.uid() and role = 'super_admin' and is_active = true
  );
$$;

-- ── app_modules ─────────────────────────────────────────────────────
create table if not exists public.app_modules (
  module_key text primary key
    check (module_key in ('empanelment','leads','proposals','monitoring','financials','knowledge')),
  enabled    boolean not null default false,
  updated_by uuid references public.afc_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_modules enable row level security;

drop policy if exists app_modules_select_all on public.app_modules;
create policy app_modules_select_all on public.app_modules
  for select to anon, authenticated using (true);

drop policy if exists app_modules_update_super_admin on public.app_modules;
create policy app_modules_update_super_admin on public.app_modules
  for update to authenticated
  using (public.is_active_super_admin())
  with check (public.is_active_super_admin() and updated_by = auth.uid());

grant select on public.app_modules to anon, authenticated;
grant update (enabled, updated_by, updated_at) on public.app_modules to authenticated;

-- Launch defaults: Empanelment + Leads ON, the rest "Coming Soon".
insert into public.app_modules (module_key, enabled) values
  ('empanelment', true),
  ('leads', true),
  ('proposals', false),
  ('monitoring', false),
  ('financials', false),
  ('knowledge', false)
on conflict (module_key) do nothing;

-- Live updates for the Module Settings page / open tabs.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_modules'
  ) then
    alter publication supabase_realtime add table public.app_modules;
  end if;
end $$;
