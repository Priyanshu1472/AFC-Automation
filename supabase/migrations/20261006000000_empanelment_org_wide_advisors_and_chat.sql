-- Two Empanelment changes:
--
-- 1. DGM / AGM / General Manager can now READ every team's applications
--    (not just their own team's), so before an advisor lets an invite go out
--    they can check whether that company is already empanelled with AFC via
--    another team — transparency + no duplicate empanelments. The list page
--    splits this into "My Team" / "All Teams" tabs; dashboards/reports keep
--    narrowing to the active team on the client. Write-side authorization is
--    unchanged — only the assigned advisor (dgm_id) can act at dgm_review,
--    enforced in the edge functions, not by this read policy.
--
-- 2. A per-application group chat. Unlike the lead/proposal chats there's no
--    roster table — the participants are fixed by the application itself:
--      - the sender (sent_by — the AC / PA / PO who sent the invite)
--      - the assigned Project Officer (project_officer_id)
--      - the assigned advising authority (dgm_id)
--      - every CFO, CS and MD (org-wide reviewers on every application)
--    So membership is derived live (is_empanelment_chat_participant) and only
--    per-user read-tracking needs its own table. Admin can read (view-only,
--    same as lead chat) but never post.

-- ── 1. Visibility ───────────────────────────────────────────────────
create or replace function public.can_view_empanelment_application(app_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empanelment_applications a
    where a.id = app_id
      and (
        public.current_afc_role() in ('md', 'cfo', 'cs', 'admin', 'dgm', 'agm', 'general_manager')
        or (
          public.current_afc_role() in (
            'srm', 'project_officer', 'associate_consultant', 'project_assistant',
            'area_manager', 'regional_manager'
          )
          and public.is_current_user_team(a.team)
        )
        or (public.current_afc_role() = 'business_associate' and a.ba_user_id = auth.uid())
      )
  );
$$;

-- ── 2. Chat ─────────────────────────────────────────────────────────
create table if not exists public.empanelment_chat_messages (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.empanelment_applications(id) on delete cascade,
  sender_id       uuid not null references public.afc_users(id),
  message         text not null,
  created_at      timestamptz not null default now()
);
create index if not exists empanelment_chat_messages_app_idx on public.empanelment_chat_messages(application_id, created_at);

create table if not exists public.empanelment_chat_reads (
  application_id  uuid not null references public.empanelment_applications(id) on delete cascade,
  user_id         uuid not null references public.afc_users(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (application_id, user_id)
);

alter table public.empanelment_chat_messages enable row level security;
alter table public.empanelment_chat_reads    enable row level security;

create or replace function public.is_empanelment_chat_participant(p_application_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empanelment_applications a
    where a.id = p_application_id
      and (
        auth.uid() in (a.sent_by, a.project_officer_id, a.dgm_id)
        or exists (
          select 1 from public.afc_users u
          where u.id = auth.uid() and u.is_active and u.role in ('cfo', 'cs', 'md')
        )
      )
  );
$$;

create policy empanelment_chat_messages_select on public.empanelment_chat_messages
for select using (
  public.is_empanelment_chat_participant(application_id)
  or public.current_afc_role() = 'admin'
);

create policy empanelment_chat_reads_select on public.empanelment_chat_reads
for select using (user_id = auth.uid());

-- No authenticated INSERT/UPDATE/DELETE policies — messages are written only
-- by the send-empanelment-chat-message edge function (service role), read
-- markers only by mark_empanelment_chat_read() below.

alter publication supabase_realtime add table public.empanelment_chat_messages;

-- Sender names via RPC rather than an embedded join: the advisor / PO / CFO /
-- CS / MD are often on a different team than the viewer, and the viewer's own
-- afc_users RLS would silently null those names (same fix as
-- get_lead_chat_participant_names).
create or replace function public.get_empanelment_chat_participant_names(p_application_id uuid)
returns table (user_id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name, u.role
  from public.afc_users u
  where (public.is_empanelment_chat_participant(p_application_id) or public.current_afc_role() = 'admin')
    and u.id in (
      select m.sender_id from public.empanelment_chat_messages m where m.application_id = p_application_id
    );
$$;
revoke all on function public.get_empanelment_chat_participant_names(uuid) from public;
grant execute on function public.get_empanelment_chat_participant_names(uuid) to authenticated;

create or replace function public.mark_empanelment_chat_read(p_application_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_empanelment_chat_participant(p_application_id) then
    return;
  end if;
  insert into public.empanelment_chat_reads (application_id, user_id, last_read_at)
  values (p_application_id, auth.uid(), now())
  on conflict (application_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;
revoke all on function public.mark_empanelment_chat_read(uuid) from public;
grant execute on function public.mark_empanelment_chat_read(uuid) to authenticated;

-- Unread = messages from others newer than the viewer's last read marker
-- (or every message from others, if they've never opened the chat).
create or replace function public.empanelment_chat_unread_count(p_application_id uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*)
  from public.empanelment_chat_messages m
  left join public.empanelment_chat_reads r on r.application_id = m.application_id and r.user_id = auth.uid()
  where m.application_id = p_application_id
    and m.sender_id <> auth.uid()
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    and public.is_empanelment_chat_participant(p_application_id);
$$;
revoke all on function public.empanelment_chat_unread_count(uuid) from public;
grant execute on function public.empanelment_chat_unread_count(uuid) to authenticated;
