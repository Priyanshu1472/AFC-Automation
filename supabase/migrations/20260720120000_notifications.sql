create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  sub_text   text,
  type       text not null,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

-- Fast "recent notifications for user" and "unread count for user" lookups.
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index notifications_user_unread_idx
  on public.notifications (user_id)
  where is_read = false;

alter table public.notifications enable row level security;

-- Each user may read only their own notifications.
create policy notifications_select_own on public.notifications
for select using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy for `authenticated` at all — mirrors the
-- application_audit_log precedent: every row is written by the
-- create-staff-user / set-user-status edge functions using the
-- service-role key. Marking as read does NOT go through a raw UPDATE
-- policy (Postgres RLS has no native column-level restriction, so a
-- policy permissive enough to let a user flip is_read would also let them
-- rewrite title/type/link/user_id on their own rows). Instead, two narrow
-- SECURITY DEFINER RPCs — mirroring mark_password_changed() in
-- 20260717064949_rls_and_rpc.sql — do exactly one thing each.

create or replace function public.mark_notification_read(notification_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.notifications
  set is_read = true
  where id = notification_id and user_id = auth.uid();
end;
$$;

revoke all on function public.mark_notification_read(bigint) from public;
grant execute on function public.mark_notification_read(bigint) to authenticated;

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.notifications
  set is_read = true
  where user_id = auth.uid() and is_read = false;
end;
$$;

revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- Enable realtime INSERT streaming for the notification bell.
alter publication supabase_realtime add table public.notifications;
