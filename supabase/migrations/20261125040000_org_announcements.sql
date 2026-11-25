-- Super Admin "Important Updates" broadcast — a one-off, full-screen,
-- un-dismissable popup shown to every active user on login (or on
-- returning to an already-open tab) until they scroll through it and
-- acknowledge. Deliberately separate from the notifications table — this
-- must never show up in the normal notification bell/panel.
--
-- Only the single latest row ever matters: sending a new announcement
-- simply supersedes whatever was there before. Once sent, an
-- announcement is final — no edit/withdraw (send a new one to correct a
-- mistake). Absence of an ack row = not yet acknowledged; no boolean
-- flag needed.
create table public.org_announcements (
  id         uuid primary key default gen_random_uuid(),
  items      jsonb not null,
  created_by uuid references public.afc_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.org_announcement_acks (
  id               uuid primary key default gen_random_uuid(),
  announcement_id  uuid not null references public.org_announcements(id) on delete cascade,
  user_id          uuid not null references public.afc_users(id) on delete cascade,
  acknowledged_at  timestamptz not null default now(),
  unique (announcement_id, user_id)
);

alter table public.org_announcements enable row level security;
alter table public.org_announcement_acks enable row level security;

-- Every active user needs to read the latest announcement to know
-- whether to show the popup at all.
create policy org_announcements_select on public.org_announcements
for select using (
  exists (select 1 from public.afc_users u where u.id = auth.uid() and u.is_active)
);

-- current_afc_role() normalizes an active Super Admin to 'admin' (every
-- Admin power, see 20261120000000_super_admin_has_admin_powers.sql), so
-- it can never read back 'super_admin' literally — this stays Super-
-- Admin-exclusive (not every Admin), so it uses is_active_super_admin()
-- instead, same as Module Settings does for the same reason.
-- Defense-in-depth behind send-announcement's own role check.
create policy org_announcements_insert on public.org_announcements
for insert with check (public.is_active_super_admin());

-- A user reads their own ack status; Super Admin reads everyone's, to
-- show a simple "N of M acknowledged" count on the compose page.
create policy org_announcement_acks_select on public.org_announcement_acks
for select using (
  user_id = auth.uid() or public.is_active_super_admin()
);

-- A trivial, low-risk, self-scoped write — unlike every PIN-gated
-- workflow action elsewhere in this app, no edge function is needed just
-- to record "I saw this."
create policy org_announcement_acks_insert on public.org_announcement_acks
for insert with check (user_id = auth.uid());

-- Live popup delivery to already-open tabs (see ImportantUpdatesModal.jsx).
alter publication supabase_realtime add table public.org_announcements;
