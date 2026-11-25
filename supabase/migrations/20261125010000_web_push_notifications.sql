-- Web Push desktop notifications: a PMIS notification pops up on the
-- recipient's desktop even when no PMIS tab is open (the browser must be
-- running). Reuses the existing notifications table and everything that
-- writes to it — nothing about how notifications are created changes.
--
--   push_subscriptions  one row per browser that has desktop notifications
--                       on, owned by the user signed in there. Written only
--                       by the push-subscription edge function (service
--                       role); RLS on with no policies keeps it closed to
--                       everyone else.
--   trigger             after a notification is inserted, or a grouped chat
--                       notification is bumped (bump_chat_notification moves
--                       its created_at), asks the send-push edge function to
--                       deliver it — via pg_net, so it's asynchronous and
--                       never slows down or fails the insert itself.
--
-- Calls go to the project URL in Vault ("project_url", shared with the
-- daily finance job) with a shared secret the database generates for itself
-- ("push_webhook_secret", created below if missing — it never leaves the
-- database: send-push checks it through verify_push_webhook_secret()).
-- Without project_url, or for a user with no subscriptions, the trigger
-- does nothing.

create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.afc_users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_webhook_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'push_webhook_secret',
      'Shared secret: notifications trigger -> send-push edge function'
    );
  end if;
end $$;

-- send-push (service role) checks the caller's secret here instead of
-- holding its own copy.
create or replace function public.verify_push_webhook_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets
    where name = 'push_webhook_secret' and decrypted_secret = p_secret
  );
$$;
revoke all on function public.verify_push_webhook_secret(text) from public, anon, authenticated;
grant execute on function public.verify_push_webhook_secret(text) to service_role;

create or replace function public.push_notification_to_devices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.is_read then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.created_at is not distinct from old.created_at then
    return new;
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    return new;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('notification_id', new.id),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  -- A push problem must never stop the notification itself being saved.
  raise warning 'push_notification_to_devices: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.push_notification_to_devices() from public;

drop trigger if exists notifications_push_to_devices on public.notifications;
create trigger notifications_push_to_devices
  after insert or update of created_at on public.notifications
  for each row execute function public.push_notification_to_devices();
