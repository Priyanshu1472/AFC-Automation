-- Proposal Activity Timeline (2026-11-23): every step on a proposal, in one
-- list, newest first.
--
-- Three sources, merged by get_proposal_timeline():
--   proposal_activity        (new) everything that isn't money: proposal
--                            opened, fee note drafted, documents, BP document
--                            requests, proposed value / Empanelment only,
--                            additional Persons Responsible, lock, client
--                            response. Written by the triggers below, plus
--                            two edge functions that act as service role and
--                            so have to name the actor themselves
--                            (send-ba-document-request,
--                            remove-proposal-responsible).
--   fee_note_events          (existing) Bid Payment Requisition Note stages.
--   proposal_finance_events  (existing) payment, EMD refund / PBG, PBG Note.
--
-- Triggers take the actor from the row's own "who" column (created_by,
-- locked_by, client_response_by, …) and fall back to auth.uid() for direct
-- client writes (documents, BP requests).

create table if not exists public.proposal_activity (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposal_preparations(id) on delete cascade,
  action      text not null,
  detail      text,
  remark      text,
  actor_id    uuid references public.afc_users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists proposal_activity_proposal_idx on public.proposal_activity (proposal_id, created_at);

alter table public.proposal_activity enable row level security;
drop policy if exists proposal_activity_select on public.proposal_activity;
create policy proposal_activity_select on public.proposal_activity
  for select using (public.can_view_proposal(proposal_id));
-- No insert/update/delete policies: only triggers (security definer) and
-- service-role edge functions write here.

create or replace function public.log_proposal_activity(
  p_proposal_id uuid, p_action text, p_actor uuid, p_detail text default null, p_remark text default null
) returns void
language sql security definer set search_path = public as $$
  insert into public.proposal_activity (proposal_id, action, detail, remark, actor_id)
  values (p_proposal_id, p_action, p_detail, nullif(trim(coalesce(p_remark, '')), ''), p_actor);
$$;
revoke all on function public.log_proposal_activity(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_proposal_activity(uuid, text, uuid, text, text) to service_role;

create or replace function public.fmt_inr(p numeric) returns text
language sql immutable as $$
  select case when p is null then null else '₹' || to_char(p, 'FM99,99,99,99,99,990.00') end;
$$;

-- ── proposal_preparations ───────────────────────────────────────────
create or replace function public.proposal_activity_on_proposal()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_proposal_activity(new.id, 'proposal_opened', new.created_by);
    return new;
  end if;

  if new.empanelment_only is distinct from old.empanelment_only then
    perform public.log_proposal_activity(
      new.id, case when new.empanelment_only then 'empanelment_on' else 'empanelment_off' end,
      coalesce(auth.uid(), new.proposed_value_updated_by));
  elsif new.proposed_value is distinct from old.proposed_value then
    perform public.log_proposal_activity(
      new.id,
      case when old.proposed_value is null then 'value_set' when new.proposed_value is null then 'value_removed' else 'value_changed' end,
      coalesce(new.proposed_value_updated_by, auth.uid()),
      case
        when old.proposed_value is null then public.fmt_inr(new.proposed_value)
        when new.proposed_value is null then public.fmt_inr(old.proposed_value)
        else public.fmt_inr(old.proposed_value) || ' → ' || public.fmt_inr(new.proposed_value)
      end);
  end if;

  if new.locked and not coalesce(old.locked, false) then
    perform public.log_proposal_activity(new.id, 'locked', coalesce(new.locked_by, auth.uid()),
      case when new.lock_reason = 'deadline_passed' then 'Deadline passed' end);
  end if;

  if new.client_response is distinct from old.client_response and new.client_response <> 'pending' then
    perform public.log_proposal_activity(
      new.id,
      case
        when new.client_response = 'rejected' then 'response_rejected'
        when new.award_kind = 'next_stage' then 'response_next_stage'
        when new.award_kind = 'empanelled' then 'response_empanelled'
        else 'response_awarded'
      end,
      coalesce(new.client_response_by, auth.uid()), null, new.client_response_remark);
  end if;

  return new;
end;
$$;

drop trigger if exists proposal_activity_on_proposal on public.proposal_preparations;
create trigger proposal_activity_on_proposal
  after insert or update on public.proposal_preparations
  for each row execute function public.proposal_activity_on_proposal();

-- ── fee_notes: drafted (later stages are in fee_note_events) ────────
create or replace function public.proposal_activity_on_fee_note()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_proposal_activity(new.proposal_id, 'fee_note_drafted', coalesce(new.created_by, auth.uid()));
  return new;
end;
$$;
drop trigger if exists proposal_activity_on_fee_note on public.fee_notes;
create trigger proposal_activity_on_fee_note
  after insert on public.fee_notes
  for each row execute function public.proposal_activity_on_fee_note();

-- ── proposal_documents ──────────────────────────────────────────────
create or replace function public.proposal_activity_on_document()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_proposal_activity(new.proposal_id, 'document_uploaded', coalesce(new.uploaded_by, auth.uid()), new.file_name);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.file_path is distinct from old.file_path then
      perform public.log_proposal_activity(new.proposal_id, 'document_replaced', coalesce(auth.uid(), new.uploaded_by), new.file_name);
    end if;
    return new;
  else
    perform public.log_proposal_activity(old.proposal_id, 'document_removed', auth.uid(), old.file_name);
    return old;
  end if;
end;
$$;
drop trigger if exists proposal_activity_on_document on public.proposal_documents;
create trigger proposal_activity_on_document
  after insert or update or delete on public.proposal_documents
  for each row execute function public.proposal_activity_on_document();

-- ── proposal_document_requests (BP documents) ───────────────────────
-- "Sent to the BP" is logged once per send by send-ba-document-request.
create or replace function public.proposal_activity_on_bp_request()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_proposal_activity(new.proposal_id, 'bp_doc_requested', coalesce(new.created_by, auth.uid()), new.item_name);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.uploaded_at is not null and new.uploaded_at is distinct from old.uploaded_at then
      perform public.log_proposal_activity(new.proposal_id, 'bp_doc_uploaded', coalesce(new.uploaded_by, auth.uid()), new.item_name);
    end if;
    return new;
  else
    -- The whole proposal being deleted cascades here too; skip that case.
    if exists (select 1 from public.proposal_preparations where id = old.proposal_id) then
      perform public.log_proposal_activity(old.proposal_id, 'bp_doc_removed', auth.uid(), old.item_name);
    end if;
    return old;
  end if;
end;
$$;
drop trigger if exists proposal_activity_on_bp_request on public.proposal_document_requests;
create trigger proposal_activity_on_bp_request
  after insert or update or delete on public.proposal_document_requests
  for each row execute function public.proposal_activity_on_bp_request();

-- ── Additional Persons Responsible: added (removal logged by the edge fn) ─
create or replace function public.proposal_activity_on_responsible()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  select full_name into v_name from public.afc_users where id = new.user_id;
  perform public.log_proposal_activity(new.proposal_id, 'responsible_added', coalesce(new.added_by, auth.uid()), v_name);
  return new;
end;
$$;
drop trigger if exists proposal_activity_on_responsible on public.proposal_additional_responsibles;
create trigger proposal_activity_on_responsible
  after insert on public.proposal_additional_responsibles
  for each row execute function public.proposal_activity_on_responsible();

-- ── Backfill: rebuild what already happened on existing proposals ───
-- Only for proposals with no activity yet, so re-running is harmless.
with fresh as (
  select pp.* from public.proposal_preparations pp
  where not exists (select 1 from public.proposal_activity a where a.proposal_id = pp.id)
)
insert into public.proposal_activity (proposal_id, action, detail, remark, actor_id, created_at)
select id, 'proposal_opened', null, null, created_by, created_at from fresh
union all
select f.id, 'fee_note_drafted', null, null, fn.created_by, fn.created_at
  from fresh f join public.fee_notes fn on fn.proposal_id = f.id
union all
select f.id, 'document_uploaded', d.file_name, null, d.uploaded_by, d.created_at
  from fresh f join public.proposal_documents d on d.proposal_id = f.id
union all
select f.id, 'bp_doc_requested', r.item_name, null, r.created_by, r.created_at
  from fresh f join public.proposal_document_requests r on r.proposal_id = f.id
union all
select f.id, 'bp_doc_uploaded', r.item_name, null, r.uploaded_by, r.uploaded_at
  from fresh f join public.proposal_document_requests r on r.proposal_id = f.id where r.uploaded_at is not null
union all
select f.id, 'responsible_added', u.full_name, null, ar.added_by, ar.created_at
  from fresh f join public.proposal_additional_responsibles ar on ar.proposal_id = f.id
  left join public.afc_users u on u.id = ar.user_id
union all
select id, 'value_set', public.fmt_inr(proposed_value), null, proposed_value_updated_by, proposed_value_updated_at
  from fresh where proposed_value is not null and proposed_value_updated_at is not null
union all
select id, 'locked', case when lock_reason = 'deadline_passed' then 'Deadline passed' end, null, locked_by, locked_at
  from fresh where locked and locked_at is not null
union all
select id,
  case when client_response = 'rejected' then 'response_rejected'
       when award_kind = 'next_stage' then 'response_next_stage'
       when award_kind = 'empanelled' then 'response_empanelled'
       else 'response_awarded' end,
  null, client_response_remark, client_response_by, client_response_at
  from fresh where client_response <> 'pending' and client_response_at is not null;

-- ── One merged, readable timeline ───────────────────────────────────
create or replace function public.get_proposal_timeline(p_proposal_id uuid)
returns table (
  id uuid, source text, action text, detail text, remark text,
  actor_id uuid, actor_name text, actor_role text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select t.id, t.source, t.action, t.detail, t.remark, t.actor_id, u.full_name, u.role, t.created_at
  from (
    select a.id, 'proposal'::text as source, a.action, a.detail, a.remark, a.actor_id, a.created_at
      from public.proposal_activity a where a.proposal_id = p_proposal_id
    union all
    select e.id, 'fee_note', e.action, null, e.remark, e.actor_id, e.created_at
      from public.fee_note_events e join public.fee_notes fn on fn.id = e.fee_note_id
      where fn.proposal_id = p_proposal_id
    union all
    select f.id, f.scope, f.action, null, f.remark, f.actor_id, f.created_at
      from public.proposal_finance_events f where f.proposal_id = p_proposal_id
  ) t
  left join public.afc_users u on u.id = t.actor_id
  where public.can_view_proposal(p_proposal_id)
  order by t.created_at desc;
$$;
revoke all on function public.get_proposal_timeline(uuid) from public, anon;
grant execute on function public.get_proposal_timeline(uuid) to authenticated, service_role;
