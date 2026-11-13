-- Monitoring / Financials: billing rework.
--
--  1. Project billing details used by the generated invoice and the
--     payment note (client address + GSTIN, contract reference, the BP's
--     revenue share, EMD / BG / advance notes).
--  2. A client invoice is always raised AGAINST something: one line per
--     milestone / deliverable it bills (client_invoice_lines). Several
--     deliverables of a milestone can go on one invoice. Invoices are
--     created and edited only through save_client_invoice(), which also
--     works out GST from the rate and numbers the instalments.
--  3. Amount guards, end to end (before-GST amounts throughout):
--       contract value  >= what's allocated to milestones/deliverables
--                          (a milestone's own amount, or — if it has none —
--                          the sum of its deliverables; plus standalone
--                          deliverables)
--       milestone amount>= Σ its deliverables' amounts
--       item amount     >= Σ invoiced against it (a milestone also counts
--                          what's invoiced against its deliverables)
--       contract value  >= Σ client invoice amounts
--       GST             <= 28% (the highest GST slab)
--       client payment  <= invoice total (less is allowed — TDS etc.)
--       BP amounts      <= what the client actually paid on that invoice
--       payment to BP   <= the BP's invoice
--  4. The BP invoice records its GST, and the Payment Note
--     (Project Payment Requisition Note) sits between the BP's invoice and
--     paying them: the team prepares it, sends it to Accounts (the CFO,
--     in-app alert), and only then can the BP be paid.
--
-- Existing rows are left as they are; the checks run on the next write.

-- ── 1. Project billing details ─────────────────────────────────────────
alter table public.monitoring_projects
  add column client_address  text,
  add column client_gstin    text,
  add column contract_ref    text,
  add column bp_share_pct    numeric(5,2) check (bp_share_pct is null or (bp_share_pct >= 0 and bp_share_pct <= 100)),
  add column advance_details text,
  add column emd_details     text,
  add column bg_details      text;

-- ── 2. Invoice lines ───────────────────────────────────────────────────
alter table public.client_invoices
  add column gst_rate       numeric(5,2) not null default 18 check (gst_rate in (0, 5, 12, 18, 28)),
  add column gst_type       text not null default 'igst' check (gst_type in ('igst', 'cgst_sgst')),
  add column subject        text,
  add column installment_no integer;

create table public.client_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.client_invoices(id) on delete cascade,
  -- RESTRICT: an invoiced milestone/deliverable can't be deleted.
  item_id     uuid not null references public.monitoring_items(id) on delete restrict,
  description text,
  amount      numeric(15,2) not null check (amount > 0),
  position    integer not null default 0,
  unique (invoice_id, item_id)
);
create index client_invoice_lines_item_idx on public.client_invoice_lines (item_id);

alter table public.client_invoice_lines enable row level security;
create policy client_invoice_lines_select on public.client_invoice_lines
  for select using (exists (
    select 1 from public.client_invoices ci
    where ci.id = invoice_id and public.can_view_monitoring_project(ci.project_id)
  ));
-- No write policies: lines are written only by save_client_invoice().

-- Existing single-item invoices become one-line invoices.
insert into public.client_invoice_lines (invoice_id, item_id, amount)
select id, item_id, amount from public.client_invoices where item_id is not null and amount > 0;

update public.client_invoices ci set installment_no = s.rn
from (select id, row_number() over (partition by project_id order by invoice_date, created_at) as rn from public.client_invoices) s
where s.id = ci.id;

-- Invoices are raised only through save_client_invoice(); direct updates
-- may still record the client's payment.
drop policy client_invoices_insert on public.client_invoices;

-- Σ invoiced against an item; for a milestone, also against its deliverables.
create or replace function public.monitoring_item_billed(p_item_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.amount), 0)
  from public.client_invoice_lines l
  join public.monitoring_items i on i.id = l.item_id
  where i.id = p_item_id or i.parent_id = p_item_id;
$$;

-- What's allocated out of the contract value: each milestone's own amount
-- (or its deliverables' sum when it has none) plus standalone deliverables.
create or replace function public.monitoring_project_allocated(p_project_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(coalesce(m.invoice_amount, (select sum(c.invoice_amount) from public.monitoring_items c where c.parent_id = m.id), 0))
    from public.monitoring_items m where m.project_id = p_project_id and m.kind = 'milestone'
  ), 0) + coalesce((
    select sum(d.invoice_amount) from public.monitoring_items d
    where d.project_id = p_project_id and d.kind = 'deliverable' and d.parent_id is null
  ), 0);
$$;

create or replace function public.save_client_invoice(
  p_invoice_id     uuid,
  p_project_id     uuid,
  p_invoice_number text,
  p_invoice_date   date,
  p_gst_rate       numeric,
  p_gst_type       text,
  p_subject        text,
  p_remarks        text,
  p_lines          jsonb
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_old     public.client_invoices%rowtype;
  v_id      uuid;
  v_amount  numeric := 0;
  v_line    jsonb;
  v_item    public.monitoring_items%rowtype;
  v_amt     numeric;
  v_cap     record;
begin
  if not public.can_edit_monitoring_project(p_project_id) then
    raise exception 'You do not have access to raise invoices on this project.';
  end if;
  if coalesce(trim(p_invoice_number), '') = '' then raise exception 'Invoice number is required.'; end if;
  if p_invoice_date is null then raise exception 'Invoice date is required.'; end if;
  if p_gst_type not in ('igst', 'cgst_sgst') then raise exception 'Choose IGST or CGST + SGST.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Select the milestone or deliverable(s) this invoice is raised against.';
  end if;
  if (select count(distinct x->>'item_id') from jsonb_array_elements(p_lines) x) <> jsonb_array_length(p_lines) then
    raise exception 'The same milestone / deliverable is selected twice.';
  end if;

  if p_invoice_id is not null then
    select * into v_old from public.client_invoices where id = p_invoice_id and project_id = p_project_id;
    if not found then raise exception 'Invoice not found.'; end if;
    if v_old.status = 'paid' then raise exception 'A paid invoice can no longer be changed.'; end if;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.monitoring_items
    where id = nullif(v_line->>'item_id', '')::uuid and project_id = p_project_id;
    if not found then raise exception 'A selected milestone / deliverable is not part of this project.'; end if;
    v_amt := round(nullif(v_line->>'amount', '')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'Enter the amount for “%”.', v_item.title; end if;
    v_amount := v_amount + v_amt;
  end loop;

  perform set_config('afc.invoice_rpc', '1', true);
  if p_invoice_id is null then
    insert into public.client_invoices (
      project_id, invoice_number, invoice_date, amount, gst_amount, gst_rate, gst_type, subject, remarks, installment_no
    ) values (
      p_project_id, trim(p_invoice_number), p_invoice_date, v_amount, round(v_amount * p_gst_rate / 100, 2),
      p_gst_rate, p_gst_type, nullif(trim(coalesce(p_subject, '')), ''), nullif(trim(coalesce(p_remarks, '')), ''),
      (select count(*) + 1 from public.client_invoices where project_id = p_project_id)
    ) returning id into v_id;
  else
    v_id := p_invoice_id;
    update public.client_invoices set
      invoice_number = trim(p_invoice_number), invoice_date = p_invoice_date,
      amount = v_amount, gst_amount = round(v_amount * p_gst_rate / 100, 2),
      gst_rate = p_gst_rate, gst_type = p_gst_type, item_id = null,
      subject = nullif(trim(coalesce(p_subject, '')), ''), remarks = nullif(trim(coalesce(p_remarks, '')), '')
    where id = v_id;
    delete from public.client_invoice_lines where invoice_id = v_id;
  end if;

  insert into public.client_invoice_lines (invoice_id, item_id, description, amount, position)
  select v_id, (x->>'item_id')::uuid, nullif(trim(coalesce(x->>'description', '')), ''), round((x->>'amount')::numeric, 2), ord::int
  from jsonb_array_elements(p_lines) with ordinality as t(x, ord);
  perform set_config('afc.invoice_rpc', '', true);

  -- Per-item caps, for every item this invoice touches and its milestone.
  for v_cap in
    select distinct c.id, c.title, c.kind, c.invoice_amount
    from public.client_invoice_lines l
    join public.monitoring_items i on i.id = l.item_id
    join public.monitoring_items c on c.id in (i.id, i.parent_id)
    where l.invoice_id = v_id and c.invoice_amount is not null
  loop
    if public.monitoring_item_billed(v_cap.id) > v_cap.invoice_amount then
      raise exception 'Only ₹% of “%”''s ₹% is left to invoice%.',
        to_char(greatest(v_cap.invoice_amount - (public.monitoring_item_billed(v_cap.id)
          - coalesce((select sum(l2.amount) from public.client_invoice_lines l2 join public.monitoring_items i2 on i2.id = l2.item_id
                      where l2.invoice_id = v_id and (i2.id = v_cap.id or i2.parent_id = v_cap.id)), 0)), 0), 'FM99,99,99,99,990.00'),
        v_cap.title,
        to_char(v_cap.invoice_amount, 'FM99,99,99,99,990.00'),
        case when v_cap.kind = 'milestone' then ' (including its deliverables)' else '' end;
    end if;
  end loop;

  return v_id;
end;
$$;
revoke all on function public.save_client_invoice(uuid, uuid, text, date, numeric, text, text, text, jsonb) from public;
grant execute on function public.save_client_invoice(uuid, uuid, text, date, numeric, text, text, text, jsonb) to authenticated;

-- ── 3. Amount guards ───────────────────────────────────────────────────
create or replace function public.monitoring_projects_amount_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_invoiced  numeric;
  v_allocated numeric;
begin
  if new.contract_value is not distinct from old.contract_value then
    return new;
  end if;
  select coalesce(sum(amount), 0) into v_invoiced from public.client_invoices where project_id = new.id;
  v_allocated := public.monitoring_project_allocated(new.id);

  if new.contract_value is null then
    if v_invoiced > 0 then
      raise exception 'The contract value can''t be cleared — invoices have already been raised against it.';
    end if;
    return new;
  end if;
  if new.contract_value < v_invoiced then
    raise exception 'The contract value can''t be less than the ₹% already invoiced (before GST).',
      to_char(v_invoiced, 'FM99,99,99,99,990.00');
  end if;
  if new.contract_value < v_allocated then
    raise exception 'The contract value can''t be less than the ₹% set across milestones and deliverables.',
      to_char(v_allocated, 'FM99,99,99,99,990.00');
  end if;
  return new;
end;
$$;

create trigger monitoring_projects_amount_guard
  before update of contract_value on public.monitoring_projects
  for each row execute function public.monitoring_projects_amount_guard();

-- AFTER trigger: checks the table as it now stands (this row included).
create or replace function public.monitoring_items_amount_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_contract  numeric;
  v_allocated numeric;
  v_parent    public.monitoring_items%rowtype;
  v_kids      numeric;
  v_billed    numeric;
begin
  if tg_op = 'UPDATE' and new.invoice_amount is not distinct from old.invoice_amount
     and new.parent_id is not distinct from old.parent_id then
    return null;
  end if;

  select contract_value into v_contract from public.monitoring_projects where id = new.project_id;
  if v_contract is not null then
    v_allocated := public.monitoring_project_allocated(new.project_id);
    if v_allocated > v_contract then
      raise exception 'Milestones and deliverables would add up to ₹%, more than the ₹% contract value.',
        to_char(v_allocated, 'FM99,99,99,99,990.00'), to_char(v_contract, 'FM99,99,99,99,990.00');
    end if;
  end if;

  -- Deliverables split their milestone's amount.
  if new.parent_id is not null then
    select * into v_parent from public.monitoring_items where id = new.parent_id;
  elsif new.kind = 'milestone' then
    v_parent := new;
  end if;
  if v_parent.id is not null and v_parent.invoice_amount is not null then
    select coalesce(sum(invoice_amount), 0) into v_kids from public.monitoring_items where parent_id = v_parent.id;
    if v_kids > v_parent.invoice_amount then
      raise exception 'The deliverables under “%” would add up to ₹%, more than the milestone''s ₹%.',
        v_parent.title, to_char(v_kids, 'FM99,99,99,99,990.00'), to_char(v_parent.invoice_amount, 'FM99,99,99,99,990.00');
    end if;
  end if;

  if new.invoice_amount is not null then
    v_billed := public.monitoring_item_billed(new.id);
    if new.invoice_amount < v_billed then
      raise exception 'The amount can''t be less than the ₹% already invoiced against it.',
        to_char(v_billed, 'FM99,99,99,99,990.00');
    end if;
  end if;
  return null;
end;
$$;

create trigger monitoring_items_amount_guard
  after insert or update of invoice_amount, parent_id on public.monitoring_items
  for each row execute function public.monitoring_items_amount_guard();

create or replace function public.client_invoices_amount_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_contract numeric;
  v_others   numeric;
begin
  -- Amounts change only through save_client_invoice().
  if tg_op = 'UPDATE' and coalesce(current_setting('afc.invoice_rpc', true), '') <> '1' and auth.uid() is not null
     and (new.amount <> old.amount or new.gst_amount <> old.gst_amount or new.item_id is distinct from old.item_id) then
    raise exception 'Use "Edit invoice" to change an invoice''s amounts.';
  end if;

  if (tg_op = 'INSERT' or new.amount <> old.amount or new.gst_amount <> old.gst_amount)
     and new.gst_amount > round(new.amount * 0.28, 2) then
    raise exception 'GST can''t be more than 28%% of the invoice amount.';
  end if;

  if new.status = 'paid' and new.payment_amount > new.amount + new.gst_amount then
    raise exception 'The amount received can''t be more than the invoice total (₹%).',
      to_char(new.amount + new.gst_amount, 'FM99,99,99,99,990.00');
  end if;

  if tg_op = 'UPDATE' and new.amount = old.amount then
    return new;
  end if;

  select contract_value into v_contract from public.monitoring_projects where id = new.project_id;
  if v_contract is null then
    raise exception 'Set the project''s contract value (Edit Details) before raising invoices.';
  end if;
  select coalesce(sum(amount), 0) into v_others
  from public.client_invoices where project_id = new.project_id and id <> new.id;
  if v_others + new.amount > v_contract then
    raise exception 'Only ₹% of the ₹% contract value is left to invoice (before GST).',
      to_char(greatest(v_contract - v_others, 0), 'FM99,99,99,99,990.00'),
      to_char(v_contract, 'FM99,99,99,99,990.00');
  end if;
  return new;
end;
$$;

create trigger client_invoices_amount_guard
  before insert or update on public.client_invoices
  for each row execute function public.client_invoices_amount_guard();

-- ── 4. BP invoice GST + payment notes ──────────────────────────────────
alter table public.bp_invoices
  add column gst_amount numeric(15,2) not null default 0 check (gst_amount >= 0);

create or replace function public.bp_invoices_amount_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_received numeric;
begin
  select payment_amount into v_received from public.client_invoices where id = new.client_invoice_id;

  if v_received is not null and new.expected_amount is not null and new.expected_amount > v_received then
    raise exception 'The amount asked from the BP can''t be more than the ₹% the client paid.',
      to_char(v_received, 'FM99,99,99,99,990.00');
  end if;
  if v_received is not null and new.amount is not null and new.amount > v_received then
    raise exception 'The BP''s invoice can''t be more than the ₹% the client paid on this invoice.',
      to_char(v_received, 'FM99,99,99,99,990.00');
  end if;
  if new.amount is not null and new.gst_amount > round((new.amount - new.gst_amount) * 0.28, 2) then
    raise exception 'The BP invoice''s GST can''t be more than 28%% of its amount before GST.';
  end if;
  if new.paid_amount is not null and new.amount is not null and new.paid_amount > new.amount then
    raise exception 'The payment to the BP can''t be more than their invoice (₹%).',
      to_char(new.amount, 'FM99,99,99,99,990.00');
  end if;
  return new;
end;
$$;

create trigger bp_invoices_amount_guard
  before insert or update on public.bp_invoices
  for each row execute function public.bp_invoices_amount_guard();

-- The BP's submission now carries the GST part of their invoice total.
drop function public.submit_bp_invoice(uuid, text, date, numeric, text, text, bigint);
create or replace function public.submit_bp_invoice(
  p_bp_invoice_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_amount numeric,
  p_gst_amount numeric,
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
  if exists (select 1 from public.bp_payment_notes n where n.bp_invoice_id = v_row.id and n.status = 'sent') then
    raise exception 'The payment note for this invoice has already gone to Accounts, so the invoice can no longer be replaced.';
  end if;
  if coalesce(trim(p_invoice_number), '') = '' then raise exception 'Invoice number is required.'; end if;
  if p_invoice_date is null then raise exception 'Invoice date is required.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the invoice amount.'; end if;
  if p_gst_amount is null or p_gst_amount < 0 or p_gst_amount >= p_amount then raise exception 'Enter a valid GST amount.'; end if;
  if p_file_path is null or p_file_path not like v_row.project_id::text || '/bp-invoices/' || v_row.id::text || '/%' then
    raise exception 'Upload the invoice file first.';
  end if;

  perform set_config('afc.bp_invoice_rpc', '1', true);
  update public.bp_invoices
  set status = 'received',
      invoice_number = trim(p_invoice_number),
      invoice_date = p_invoice_date,
      amount = round(p_amount, 2),
      gst_amount = round(p_gst_amount, 2),
      file_name = p_file_name,
      file_path = p_file_path,
      file_size = p_file_size,
      submitted_at = now(),
      submitted_by = auth.uid()
  where id = p_bp_invoice_id;
  perform set_config('afc.bp_invoice_rpc', '', true);
end;
$$;
revoke all on function public.submit_bp_invoice(uuid, text, date, numeric, numeric, text, text, bigint) from public;
grant execute on function public.submit_bp_invoice(uuid, text, date, numeric, numeric, text, text, bigint) to authenticated;

create table public.bp_payment_notes (
  id                     uuid primary key default gen_random_uuid(),
  bp_invoice_id          uuid not null unique references public.bp_invoices(id) on delete cascade,
  project_id             uuid not null references public.monitoring_projects(id) on delete cascade,
  note_date              date not null default current_date,
  physical_status        text,
  completion_certificate text,
  project_profile        text,
  recommendation         text not null check (length(trim(recommendation)) > 0),
  observation            text,
  status                 text not null default 'draft' check (status in ('draft', 'sent')),
  prepared_by            uuid references public.afc_users(id) on delete set null default auth.uid(),
  sent_at                timestamptz,
  sent_by                uuid references public.afc_users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create or replace function public.bp_payment_notes_before_write()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_bp public.bp_invoices%rowtype;
begin
  select * into v_bp from public.bp_invoices where id = new.bp_invoice_id;
  if not found or v_bp.project_id <> new.project_id then
    raise exception 'The BP invoice belongs to a different project.';
  end if;
  if tg_op = 'INSERT' and v_bp.status = 'requested' then
    raise exception 'The payment note can be made once the BP''s invoice has been received.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'sent' then
    raise exception 'This payment note has already been sent to Accounts.';
  end if;
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status <> 'sent') then
    new.sent_at := now();
    new.sent_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger bp_payment_notes_before_write
  before insert or update on public.bp_payment_notes
  for each row execute function public.bp_payment_notes_before_write();

-- Sent to Accounts: every active CFO gets an in-app alert (no email).
create or replace function public.bp_payment_notes_after_sent()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_bp    public.bp_invoices%rowtype;
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status <> 'sent') then
    select * into v_bp from public.bp_invoices where id = new.bp_invoice_id;
    select l.title into v_title from public.monitoring_projects mp join public.leads l on l.id = mp.lead_id where mp.id = new.project_id;
    insert into public.notifications (user_id, title, sub_text, type, link)
    select u.id,
           'Payment note: pay BP invoice ' || coalesce(v_bp.invoice_number, ''),
           coalesce(v_title, 'Project') || ' — ₹' || to_char(v_bp.amount, 'FM99,99,99,99,990.00') || ' to be released to the Business Partner.',
           'action_required',
           '/financials'
    from public.afc_users u where u.role = 'cfo' and u.is_active;
  end if;
  return null;
end;
$$;

create trigger bp_payment_notes_after_sent
  after insert or update of status on public.bp_payment_notes
  for each row execute function public.bp_payment_notes_after_sent();

alter table public.bp_payment_notes enable row level security;
create policy bp_payment_notes_select on public.bp_payment_notes
  for select using (public.can_view_monitoring_project(project_id) or public.current_afc_role() = 'cfo');
create policy bp_payment_notes_insert on public.bp_payment_notes
  for insert with check (public.can_edit_monitoring_project(project_id));
create policy bp_payment_notes_update on public.bp_payment_notes
  for update using (public.can_edit_monitoring_project(project_id)) with check (public.can_edit_monitoring_project(project_id));
create policy bp_payment_notes_delete on public.bp_payment_notes
  for delete using (public.can_edit_monitoring_project(project_id) and status = 'draft');

-- Accounts (CFO) records the payment to the BP — only once the payment
-- note has been sent to them.
create policy bp_invoices_update_accounts on public.bp_invoices
  for update using (public.current_afc_role() = 'cfo') with check (public.current_afc_role() = 'cfo');

create or replace function public.bp_invoices_require_payment_note()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status <> 'paid'
     and not exists (select 1 from public.bp_payment_notes n where n.bp_invoice_id = new.id and n.status = 'sent') then
    raise exception 'Send the payment note to Accounts before recording the payment to the BP.';
  end if;
  return new;
end;
$$;

create trigger bp_invoices_require_payment_note
  before update of status on public.bp_invoices
  for each row execute function public.bp_invoices_require_payment_note();

-- The BP's own requests now also return the GST part of their invoice.
drop function public.my_bp_invoice_requests();
create function public.my_bp_invoice_requests()
returns table (
  id uuid, project_id uuid, status text, expected_amount numeric, request_note text,
  requested_at timestamptz, invoice_number text, invoice_date date, amount numeric, gst_amount numeric,
  file_name text, file_path text, file_size bigint, submitted_at timestamptz,
  paid_on date, paid_amount numeric, payment_reference text,
  project_title text, client_name text
)
language sql stable security definer set search_path = public as $$
  select b.id, b.project_id, b.status, b.expected_amount, b.request_note,
         b.requested_at, b.invoice_number, b.invoice_date, b.amount, b.gst_amount,
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
