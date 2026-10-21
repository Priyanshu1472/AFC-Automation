-- Monitoring + Financials, plus the Proposal changes they depend on.
--
-- Proposal side:
--   * proposal_preparations.proposed_value — the total value AFC quoted
--     (the "Financial" figure). Required before a proposal can be locked;
--     becomes the starting contract value once the proposal is awarded.
--   * proposal_documents is no longer three fixed slots (technical /
--     financial / proposal_3) — any number of files per proposal.
--
-- Monitoring: an awarded proposal (and ONLY an awarded one) gets exactly
-- one monitoring_projects row, created by a trigger the moment
-- client_response flips to 'awarded'. Inside it:
--   * monitoring_documents — MoUs (client / BP), work orders, and any other
--     proof or document the client sends, one generic categorised list.
--   * monitoring_items — milestones and deliverables (a deliverable may sit
--     under a milestone), each with a due date. Any item can be marked
--     "invoice on completion"; completing it raises an alert to invoice the
--     client.
--
-- Financials:
--   * client_invoices — AFC's invoice to the client (AFC's own format, so
--     the file is uploaded as-is), then the payment received against it.
--   * bp_invoices — once the client has paid, the BP is asked to raise
--     their invoice (in whatever format they use — they upload the file and
--     key in number/date/amount), then AFC records paying the BP.
--
-- Who can do what:
--   view  — anyone who can view the underlying lead, EXCEPT a Business
--           Partner (BPs only ever see their own bp_invoices rows).
--   edit  — md/admin, or the lead's Person Responsible / Reviewer /
--           Recommending Authority (same people who run the proposal).

-- ── Proposal: proposed value + multi-file documents ────────────────────

alter table public.proposal_preparations
  add column proposed_value numeric(15,2) check (proposed_value is null or proposed_value >= 0),
  add column proposed_value_updated_at timestamptz,
  add column proposed_value_updated_by uuid references public.afc_users(id) on delete set null;

-- Allowed until the proposal is locked — deliberately NOT blocked by the
-- submission deadline (unlike can_edit_proposal()), since the quoted value
-- is bookkeeping that may need recording after the bid already went in,
-- and lock-proposal requires it.
create or replace function public.set_proposal_proposed_value(p_proposal_id uuid, p_value numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_locked boolean;
  v_pr uuid;
  v_rev uuid;
  v_ra uuid;
begin
  select pp.locked, l.person_responsible_id, l.reviewer_id, l.recommending_authority_id
  into v_locked, v_pr, v_rev, v_ra
  from public.proposal_preparations pp
  join public.leads l on l.id = pp.lead_id
  where pp.id = p_proposal_id;

  if not found then raise exception 'Proposal not found.'; end if;
  if v_locked then raise exception 'This proposal is locked — the proposed value can no longer be changed.'; end if;
  if not (
    public.current_afc_role() in ('md', 'admin')
    or auth.uid() in (v_pr, v_rev, v_ra)
  ) then
    raise exception 'You do not have access to this proposal.';
  end if;
  if p_value is null or p_value <= 0 then raise exception 'Enter a proposed value greater than zero.'; end if;

  update public.proposal_preparations
  set proposed_value = round(p_value, 2),
      proposed_value_updated_at = now(),
      proposed_value_updated_by = auth.uid()
  where id = p_proposal_id;
end;
$$;

revoke all on function public.set_proposal_proposed_value(uuid, numeric) from public;
grant execute on function public.set_proposal_proposed_value(uuid, numeric) to authenticated;

-- No live rows exist in proposal_documents (checked before writing this),
-- so the old per-slot constraints can simply go.
alter table public.proposal_documents drop constraint if exists proposal_documents_proposal_id_doc_type_key;
alter table public.proposal_documents drop constraint if exists proposal_documents_doc_type_check;
alter table public.proposal_documents alter column doc_type set default 'proposal';
alter table public.proposal_documents
  add column uploaded_by uuid references public.afc_users(id) on delete set null default auth.uid();
create index if not exists proposal_documents_proposal_id_idx on public.proposal_documents (proposal_id, created_at);

-- ── Monitoring projects ────────────────────────────────────────────────

create table public.monitoring_projects (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null unique references public.proposal_preparations(id) on delete cascade,
  lead_id        uuid not null unique references public.leads(id),
  status         text not null default 'active' check (status in ('active', 'on_hold', 'completed')),
  contract_value numeric(15,2) check (contract_value is null or contract_value >= 0),
  start_date     date,
  end_date       date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create or replace function public.can_view_monitoring_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.current_afc_role() <> 'business_associate' and public.can_view_lead(mp.lead_id)
    from public.monitoring_projects mp
    where mp.id = p_project_id
  ), false);
$$;

create or replace function public.can_edit_monitoring_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.monitoring_projects mp
    join public.leads l on l.id = mp.lead_id
    where mp.id = p_project_id
      and (
        public.current_afc_role() in ('md', 'admin')
        or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id)
      )
  );
$$;

-- The people alerts go to: the lead's Person Responsible, Reviewer, and
-- Recommending Authority.
create or replace function public.monitoring_team_ids(p_project_id uuid)
returns uuid[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[l.person_responsible_id, l.reviewer_id, l.recommending_authority_id], null)
  from public.monitoring_projects mp
  join public.leads l on l.id = mp.lead_id
  where mp.id = p_project_id;
$$;

create or replace function public.notify_monitoring_team(p_project_id uuid, p_title text, p_sub text, p_link text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, title, sub_text, type, link)
  select distinct u, p_title, p_sub, 'action_required', p_link
  from unnest(public.monitoring_team_ids(p_project_id)) as u
  join public.afc_users au on au.id = u and au.is_active;
end;
$$;
revoke all on function public.notify_monitoring_team(uuid, text, text, text) from public;

alter table public.monitoring_projects enable row level security;
create policy monitoring_projects_select on public.monitoring_projects
  for select using (public.can_view_monitoring_project(id));
-- Rows are created only by the award trigger below; staff can edit the
-- project's own details (contract value, dates, status, notes).
create policy monitoring_projects_update on public.monitoring_projects
  for update using (public.can_edit_monitoring_project(id)) with check (public.can_edit_monitoring_project(id));

-- An award opens monitoring; nothing else does. Contract value starts as
-- the proposed value and can be corrected in Monitoring afterwards.
create or replace function public.open_monitoring_on_award()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid;
  v_title text;
begin
  if new.client_response = 'awarded' and old.client_response is distinct from 'awarded' then
    insert into public.monitoring_projects (proposal_id, lead_id, contract_value)
    values (new.id, new.lead_id, new.proposed_value)
    on conflict do nothing
    returning id into v_project_id;

    if v_project_id is not null then
      select title into v_title from public.leads where id = new.lead_id;
      perform public.notify_monitoring_team(
        v_project_id,
        'Proposal awarded — set up monitoring',
        coalesce(v_title, 'Project') || ': upload the MoUs / work order and add milestones and deliverables.',
        '/monitoring/' || v_project_id
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger proposal_preparations_open_monitoring
  after update of client_response on public.proposal_preparations
  for each row execute function public.open_monitoring_on_award();

-- Backfill: proposals already marked awarded before this module existed.
insert into public.monitoring_projects (proposal_id, lead_id, contract_value)
select pp.id, pp.lead_id, pp.proposed_value
from public.proposal_preparations pp
where pp.client_response = 'awarded'
on conflict do nothing;

-- ── Monitoring documents ───────────────────────────────────────────────

create table public.monitoring_documents (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.monitoring_projects(id) on delete cascade,
  category    text not null check (category in ('mou_client', 'mou_bp', 'work_order', 'client_document', 'other')),
  title       text,
  file_name   text not null,
  file_path   text not null,
  file_size   bigint,
  uploaded_by uuid references public.afc_users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index monitoring_documents_project_idx on public.monitoring_documents (project_id, created_at);

alter table public.monitoring_documents enable row level security;
create policy monitoring_documents_select on public.monitoring_documents
  for select using (public.can_view_monitoring_project(project_id));
create policy monitoring_documents_insert on public.monitoring_documents
  for insert with check (public.can_edit_monitoring_project(project_id) and file_path like project_id::text || '/%');
create policy monitoring_documents_delete on public.monitoring_documents
  for delete using (public.can_edit_monitoring_project(project_id));

-- ── Milestones & deliverables ──────────────────────────────────────────

create table public.monitoring_items (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.monitoring_projects(id) on delete cascade,
  kind                  text not null check (kind in ('milestone', 'deliverable')),
  -- A deliverable may belong to a milestone; milestones never nest.
  parent_id             uuid references public.monitoring_items(id) on delete cascade,
  title                 text not null check (length(trim(title)) > 0),
  description           text,
  due_date              date,
  status                text not null default 'pending' check (status in ('pending', 'completed')),
  completed_at          timestamptz,
  completed_by          uuid references public.afc_users(id) on delete set null,
  completion_note       text,
  invoice_on_completion boolean not null default false,
  invoice_amount        numeric(15,2) check (invoice_amount is null or invoice_amount >= 0),
  -- Dedupe flags for the due-date alerts (monitoring_sync_due_alerts).
  due_soon_alerted_on   date,
  overdue_alerted_on    date,
  created_by            uuid references public.afc_users(id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (parent_id is null or kind = 'deliverable'),
  check (parent_id is null or parent_id <> id)
);
create index monitoring_items_project_idx on public.monitoring_items (project_id, due_date);

-- Keeps a deliverable's milestone inside the same project, and stamps who
-- completed an item and when (so the client can't forge either).
create or replace function public.monitoring_items_before_write()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.monitoring_items p
    where p.id = new.parent_id and p.project_id = new.project_id and p.kind = 'milestone'
  ) then
    raise exception 'A deliverable can only be placed under a milestone of the same project.';
  end if;

  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
    new.completed_by := auth.uid();
  elsif new.status = 'pending' then
    new.completed_at := null;
    new.completed_by := null;
    new.completion_note := null;
  end if;

  -- Moving a due date resets its alerts, so the new date alerts again.
  if tg_op = 'UPDATE' and new.due_date is distinct from old.due_date then
    new.due_soon_alerted_on := null;
    new.overdue_alerted_on := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger monitoring_items_before_write
  before insert or update on public.monitoring_items
  for each row execute function public.monitoring_items_before_write();

-- Completing an item that's billable alerts the team to invoice the client.
create or replace function public.monitoring_items_after_complete()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_lead_title text;
begin
  if new.status = 'completed' and old.status <> 'completed' and new.invoice_on_completion then
    select l.title into v_lead_title
    from public.monitoring_projects mp join public.leads l on l.id = mp.lead_id
    where mp.id = new.project_id;

    perform public.notify_monitoring_team(
      new.project_id,
      'Raise invoice: ' || (case when new.kind = 'milestone' then 'milestone' else 'deliverable' end) || ' completed',
      '"' || new.title || '" (' || coalesce(v_lead_title, 'project') || ') is complete — raise the client invoice'
        || coalesce(' for ₹' || to_char(new.invoice_amount, 'FM99,99,99,99,990.00'), '') || '.',
      '/monitoring/' || new.project_id
    );
  end if;
  return new;
end;
$$;

create trigger monitoring_items_after_complete
  after update of status on public.monitoring_items
  for each row execute function public.monitoring_items_after_complete();

alter table public.monitoring_items enable row level security;
create policy monitoring_items_select on public.monitoring_items
  for select using (public.can_view_monitoring_project(project_id));
create policy monitoring_items_insert on public.monitoring_items
  for insert with check (public.can_edit_monitoring_project(project_id));
create policy monitoring_items_update on public.monitoring_items
  for update using (public.can_edit_monitoring_project(project_id)) with check (public.can_edit_monitoring_project(project_id));
create policy monitoring_items_delete on public.monitoring_items
  for delete using (public.can_edit_monitoring_project(project_id));

-- ── Client invoices (AFC → client) ─────────────────────────────────────

create table public.client_invoices (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.monitoring_projects(id) on delete cascade,
  item_id               uuid references public.monitoring_items(id) on delete set null,
  invoice_number        text not null check (length(trim(invoice_number)) > 0),
  invoice_date          date not null,
  amount                numeric(15,2) not null check (amount >= 0),
  gst_amount            numeric(15,2) not null default 0 check (gst_amount >= 0),
  total_amount          numeric(15,2) generated always as (amount + gst_amount) stored,
  file_name             text,
  file_path             text,
  file_size             bigint,
  remarks               text,
  status                text not null default 'raised' check (status in ('raised', 'paid')),
  payment_received_on   date,
  payment_amount        numeric(15,2) check (payment_amount is null or payment_amount >= 0),
  payment_reference     text,
  payment_recorded_by   uuid references public.afc_users(id) on delete set null,
  created_by            uuid references public.afc_users(id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (file_path is null or file_path like project_id::text || '/%'),
  check (status <> 'paid' or (payment_received_on is not null and payment_amount is not null))
);
create index client_invoices_project_idx on public.client_invoices (project_id, invoice_date);
create unique index client_invoices_number_uniq on public.client_invoices (lower(trim(invoice_number)));

create or replace function public.client_invoices_before_write()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null and not exists (
    select 1 from public.monitoring_items i where i.id = new.item_id and i.project_id = new.project_id
  ) then
    raise exception 'The linked milestone/deliverable belongs to a different project.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'paid' and new.status = 'raised'
     and exists (select 1 from public.bp_invoices b where b.client_invoice_id = new.id) then
    raise exception 'The Business Partner has already been asked to invoice against this payment, so it cannot be un-marked.';
  end if;
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then
    new.payment_recorded_by := auth.uid();
  elsif new.status = 'raised' then
    new.payment_received_on := null;
    new.payment_amount := null;
    new.payment_reference := null;
    new.payment_recorded_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Payment received from the client: if the project has a BP, the next step
-- is asking them for their invoice.
create or replace function public.client_invoices_after_paid()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ba uuid;
  v_title text;
begin
  if new.status = 'paid' and old.status <> 'paid' then
    select l.assigned_ba_id, l.title into v_ba, v_title
    from public.monitoring_projects mp join public.leads l on l.id = mp.lead_id
    where mp.id = new.project_id;

    perform public.notify_monitoring_team(
      new.project_id,
      'Client payment received — invoice ' || new.invoice_number,
      case when v_ba is not null
        then coalesce(v_title, 'Project') || ': ask the Business Partner to raise their invoice.'
        else coalesce(v_title, 'Project') || ': payment recorded.'
      end,
      '/monitoring/' || new.project_id
    );
  end if;
  return new;
end;
$$;

alter table public.client_invoices enable row level security;
create policy client_invoices_select on public.client_invoices
  for select using (public.can_view_monitoring_project(project_id));
create policy client_invoices_insert on public.client_invoices
  for insert with check (public.can_edit_monitoring_project(project_id));
create policy client_invoices_update on public.client_invoices
  for update using (public.can_edit_monitoring_project(project_id)) with check (public.can_edit_monitoring_project(project_id));
create policy client_invoices_delete on public.client_invoices
  for delete using (public.can_edit_monitoring_project(project_id) and status = 'raised');

-- ── BP invoices (BP → AFC) ─────────────────────────────────────────────

create table public.bp_invoices (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.monitoring_projects(id) on delete cascade,
  -- One BP invoice per client payment. RESTRICT: a client invoice the BP
  -- was already asked to bill against can't be deleted out from under it.
  client_invoice_id  uuid not null unique references public.client_invoices(id) on delete restrict,
  bp_id              uuid references public.afc_users(id) on delete set null,
  status             text not null default 'requested' check (status in ('requested', 'received', 'paid')),
  expected_amount    numeric(15,2) check (expected_amount is null or expected_amount >= 0),
  request_note       text,
  requested_at       timestamptz not null default now(),
  requested_by       uuid references public.afc_users(id) on delete set null,
  last_reminded_at   timestamptz,
  invoice_number     text,
  invoice_date       date,
  amount             numeric(15,2) check (amount is null or amount >= 0),
  file_name          text,
  file_path          text,
  file_size          bigint,
  submitted_at       timestamptz,
  submitted_by       uuid references public.afc_users(id) on delete set null,
  paid_on            date,
  paid_amount        numeric(15,2) check (paid_amount is null or paid_amount >= 0),
  payment_reference  text,
  paid_recorded_by   uuid references public.afc_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (file_path is null or file_path like project_id::text || '/bp-invoices/' || id::text || '/%'),
  check (status = 'requested' or (invoice_number is not null and invoice_date is not null and amount is not null and file_path is not null)),
  check (status <> 'paid' or (paid_on is not null and paid_amount is not null))
);
create index bp_invoices_bp_idx on public.bp_invoices (bp_id, status);

create trigger client_invoices_before_write
  before insert or update on public.client_invoices
  for each row execute function public.client_invoices_before_write();

create trigger client_invoices_after_paid
  after update of status on public.client_invoices
  for each row execute function public.client_invoices_after_paid();

-- Staff may only move a received BP invoice to paid (or back) through
-- direct updates; everything about the BP's own submission goes through
-- submit_bp_invoice(). Rows are created by the request-bp-invoice edge
-- function (service role), which also emails the BP.
create or replace function public.bp_invoices_before_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Service role (edge functions) and submit_bp_invoice() set this flag.
  if coalesce(current_setting('afc.bp_invoice_rpc', true), '') <> '1' and auth.uid() is not null then
    if new.invoice_number is distinct from old.invoice_number
       or new.invoice_date is distinct from old.invoice_date
       or new.amount is distinct from old.amount
       or new.file_path is distinct from old.file_path
       or new.bp_id is distinct from old.bp_id
       or new.client_invoice_id is distinct from old.client_invoice_id
       or new.project_id is distinct from old.project_id then
      raise exception 'Use "Upload BP invoice" to change the Business Partner''s invoice details.';
    end if;
    if not ((old.status = 'received' and new.status in ('received', 'paid'))
            or (old.status = 'paid' and new.status in ('paid', 'received'))
            or (old.status = new.status)) then
      raise exception 'Invalid status change.';
    end if;
  end if;

  if new.status = 'paid' and old.status <> 'paid' then
    new.paid_recorded_by := auth.uid();
  elsif new.status <> 'paid' then
    new.paid_on := null;
    new.paid_amount := null;
    new.payment_reference := null;
    new.paid_recorded_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger bp_invoices_before_update
  before update on public.bp_invoices
  for each row execute function public.bp_invoices_before_update();

create or replace function public.bp_invoices_after_update()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  select l.title into v_title
  from public.monitoring_projects mp join public.leads l on l.id = mp.lead_id
  where mp.id = new.project_id;

  if new.status = 'received' and old.status = 'requested' then
    perform public.notify_monitoring_team(
      new.project_id,
      'BP invoice received — release payment',
      coalesce(v_title, 'Project') || ': invoice ' || coalesce(new.invoice_number, '') || ' for ₹'
        || to_char(new.amount, 'FM99,99,99,99,990.00') || ' is ready for payment.',
      '/monitoring/' || new.project_id
    );
  elsif new.status = 'paid' and old.status <> 'paid' and new.bp_id is not null then
    insert into public.notifications (user_id, title, sub_text, type, link)
    values (
      new.bp_id,
      'Payment released by AFC',
      'Your invoice ' || coalesce(new.invoice_number, '') || ' for ' || coalesce(v_title, 'the project')
        || ' has been paid (₹' || to_char(new.paid_amount, 'FM99,99,99,99,990.00') || ').',
      'info',
      '/home'
    );
  end if;
  return new;
end;
$$;

create trigger bp_invoices_after_update
  after update of status on public.bp_invoices
  for each row execute function public.bp_invoices_after_update();

alter table public.bp_invoices enable row level security;
create policy bp_invoices_select on public.bp_invoices
  for select using (public.can_view_monitoring_project(project_id) or bp_id = auth.uid());
create policy bp_invoices_update on public.bp_invoices
  for update using (public.can_edit_monitoring_project(project_id)) with check (public.can_edit_monitoring_project(project_id));

-- The BP (or staff on their behalf, when the invoice arrived by email)
-- submits the BP's invoice. Allowed while requested, or received-but-not-
-- yet-paid (to replace a wrong upload).
create or replace function public.submit_bp_invoice(
  p_bp_invoice_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_amount numeric,
  p_file_name text,
  p_file_path text,
  p_file_size bigint
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row public.bp_invoices%rowtype;
begin
  select * into v_row from public.bp_invoices where id = p_bp_invoice_id;
  if not found then raise exception 'Invoice request not found.'; end if;
  if not (v_row.bp_id = auth.uid() or public.can_edit_monitoring_project(v_row.project_id)) then
    raise exception 'You do not have access to this invoice request.';
  end if;
  if v_row.status = 'paid' then raise exception 'This invoice has already been paid and can no longer be changed.'; end if;
  if coalesce(trim(p_invoice_number), '') = '' then raise exception 'Invoice number is required.'; end if;
  if p_invoice_date is null then raise exception 'Invoice date is required.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the invoice amount.'; end if;
  if p_file_path is null or p_file_path not like v_row.project_id::text || '/bp-invoices/' || v_row.id::text || '/%' then
    raise exception 'Upload the invoice file first.';
  end if;

  perform set_config('afc.bp_invoice_rpc', '1', true);
  update public.bp_invoices
  set status = 'received',
      invoice_number = trim(p_invoice_number),
      invoice_date = p_invoice_date,
      amount = round(p_amount, 2),
      file_name = p_file_name,
      file_path = p_file_path,
      file_size = p_file_size,
      submitted_at = now(),
      submitted_by = auth.uid()
  where id = p_bp_invoice_id;
  perform set_config('afc.bp_invoice_rpc', '', true);
end;
$$;

revoke all on function public.submit_bp_invoice(uuid, text, date, numeric, text, text, bigint) from public;
grant execute on function public.submit_bp_invoice(uuid, text, date, numeric, text, text, bigint) to authenticated;

-- ── Due-date alerts ─────────────────────────────────────────────────────
-- Idempotent: each pending item alerts once when it comes within 7 days of
-- its due date, and once when it goes overdue (per due date — moving the
-- date re-arms both). Called whenever anyone opens Home or Monitoring, so
-- no scheduler is needed for the in-app alerts.
create or replace function public.monitoring_sync_due_alerts()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_count integer := 0;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for r in
    select i.id, i.project_id, i.kind, i.title, i.due_date, l.title as lead_title,
           (i.due_date < v_today) as is_overdue
    from public.monitoring_items i
    join public.monitoring_projects mp on mp.id = i.project_id
    join public.leads l on l.id = mp.lead_id
    where i.status = 'pending'
      and mp.status = 'active'
      and i.due_date is not null
      and (
        (i.due_date < v_today and i.overdue_alerted_on is distinct from i.due_date)
        or (i.due_date between v_today and v_today + 7 and i.due_soon_alerted_on is distinct from i.due_date)
      )
    for update of i skip locked
  loop
    perform public.notify_monitoring_team(
      r.project_id,
      (case when r.is_overdue then 'Overdue ' else 'Due soon: ' end)
        || (case when r.kind = 'milestone' then 'milestone' else 'deliverable' end) || ' "' || r.title || '"',
      coalesce(r.lead_title, 'Project') || ' — due ' || to_char(r.due_date, 'DD Mon YYYY') || '.',
      '/monitoring/' || r.project_id
    );
    if r.is_overdue then
      update public.monitoring_items set overdue_alerted_on = r.due_date, due_soon_alerted_on = r.due_date where id = r.id;
    else
      update public.monitoring_items set due_soon_alerted_on = r.due_date where id = r.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.monitoring_sync_due_alerts() from public;
grant execute on function public.monitoring_sync_due_alerts() to authenticated;

-- ── Storage: one private bucket for monitoring + invoice files ─────────
-- Paths:   {project_id}/docs/...                       staff
--          {project_id}/client-invoices/...            staff
--          {project_id}/bp-invoices/{bp_invoice_id}/... the BP or staff

insert into storage.buckets (id, name, public)
values ('monitoring-documents', 'monitoring-documents', false)
on conflict (id) do nothing;

create or replace function public.can_upload_bp_invoice_path(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 2) = 'bp-invoices' and exists (
    select 1 from public.bp_invoices b
    where b.id::text = split_part(p_name, '/', 3)
      and b.project_id::text = split_part(p_name, '/', 1)
      and b.status <> 'paid'
      and (b.bp_id = auth.uid() or public.can_edit_monitoring_project(b.project_id))
  );
$$;

create or replace function public.can_read_monitoring_path(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    case
      when public.current_afc_role() = 'business_associate' then
        split_part(p_name, '/', 2) = 'bp-invoices' and exists (
          select 1 from public.bp_invoices b
          where b.id::text = split_part(p_name, '/', 3) and b.bp_id = auth.uid()
        )
      else exists (
        select 1 from public.monitoring_projects mp
        where mp.id::text = split_part(p_name, '/', 1) and public.can_view_monitoring_project(mp.id)
      )
    end;
$$;

create policy monitoring_documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'monitoring-documents' and (
      public.can_upload_bp_invoice_path(name)
      or (
        split_part(name, '/', 2) in ('docs', 'client-invoices')
        and exists (
          select 1 from public.monitoring_projects mp
          where mp.id::text = split_part(name, '/', 1) and public.can_edit_monitoring_project(mp.id)
        )
      )
    )
  );

create policy monitoring_documents_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'monitoring-documents' and public.can_read_monitoring_path(name));

create policy monitoring_documents_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'monitoring-documents' and exists (
      select 1 from public.monitoring_projects mp
      where mp.id::text = split_part(name, '/', 1) and public.can_edit_monitoring_project(mp.id)
    )
  );

-- ── BP portal: the BP's own invoice requests ─────────────────────────
-- BPs can't read monitoring_projects (contract value, notes, etc.), so
-- the project title they need comes through this narrow function instead.
create or replace function public.my_bp_invoice_requests()
returns table (
  id uuid, project_id uuid, status text, expected_amount numeric, request_note text,
  requested_at timestamptz, invoice_number text, invoice_date date, amount numeric,
  file_name text, file_path text, file_size bigint, submitted_at timestamptz,
  paid_on date, paid_amount numeric, payment_reference text,
  project_title text, client_name text
)
language sql stable security definer set search_path = public as $$
  select b.id, b.project_id, b.status, b.expected_amount, b.request_note,
         b.requested_at, b.invoice_number, b.invoice_date, b.amount,
         b.file_name, b.file_path, b.file_size, b.submitted_at,
         b.paid_on, b.paid_amount, b.payment_reference,
         l.title, l.client_name
  from public.bp_invoices b
  join public.monitoring_projects mp on mp.id = b.project_id
  join public.leads l on l.id = mp.lead_id
  where b.bp_id = auth.uid()
  order by (b.status = 'requested') desc, b.requested_at desc;
$$;

revoke all on function public.my_bp_invoice_requests() from public;
grant execute on function public.my_bp_invoice_requests() to authenticated;
