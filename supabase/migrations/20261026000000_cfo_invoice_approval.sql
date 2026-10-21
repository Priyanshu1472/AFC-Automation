-- Client invoices now go through the CFO before the client ever sees them:
-- raising one sets it to 'pending_cfo' (was 'raised' outright); the CFO
-- accepts (→ 'raised', PIN-signed, same pattern as decide-fee-note-md) or
-- rejects with a remark (→ 'rejected', team can fix and resubmit). Existing
-- rows already at 'raised'/'paid' are untouched — they were signed on the
-- printed copy, same as before; nothing is backfilled onto them.
alter table public.client_invoices drop constraint client_invoices_status_check;
alter table public.client_invoices add constraint client_invoices_status_check
  check (status in ('pending_cfo', 'raised', 'rejected', 'paid'));
alter table public.client_invoices alter column status set default 'pending_cfo';

alter table public.client_invoices add column cfo_decided_by uuid references public.afc_users(id) on delete set null;
alter table public.client_invoices add column cfo_decided_at timestamptz;
alter table public.client_invoices add column cfo_remark text;

-- Only the CFO's own decision (decide-client-invoice, service role — auth.uid()
-- is null there) may move an invoice off 'pending_cfo'; a direct user update
-- (e.g. the team trying to self-approve) is blocked.
create or replace function public.client_invoices_before_write()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null and not exists (
    select 1 from public.monitoring_items i where i.id = new.item_id and i.project_id = new.project_id
  ) then
    raise exception 'The linked milestone/deliverable belongs to a different project.';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and old.status = 'pending_cfo'
     and new.status is distinct from old.status then
    raise exception 'Only the CFO can approve or reject this invoice.';
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

-- CFO alert: a new invoice, or one resubmitted after rejection.
create or replace function public.client_invoices_notify_cfo()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  if new.status = 'pending_cfo' and (tg_op = 'INSERT' or old.status is distinct from 'pending_cfo') then
    select l.title into v_title from public.monitoring_projects mp join public.leads l on l.id = mp.lead_id where mp.id = new.project_id;
    insert into public.notifications (user_id, title, sub_text, type, link)
    select id, 'Invoice awaiting your approval — ' || new.invoice_number,
      coalesce(v_title, 'A project') || ': ' || to_char(new.amount + new.gst_amount, 'FM99,99,99,99,990.00') || ' invoice raised for your approval.',
      'action_required', '/monitoring/' || new.project_id
    from public.afc_users where role = 'cfo' and is_active;
  end if;
  return new;
end;
$$;

-- A not-yet-approved (or rejected) invoice can still be deleted by the team,
-- same as before for 'raised'; once the CFO has signed it ('raised' after
-- their approval) or it's paid, it can't be.
drop policy client_invoices_delete on public.client_invoices;
create policy client_invoices_delete on public.client_invoices
  for delete using (public.can_edit_monitoring_project(project_id) and status in ('pending_cfo', 'rejected'));

create trigger client_invoices_notify_cfo
  after insert or update of status on public.client_invoices
  for each row execute function public.client_invoices_notify_cfo();

-- A rejected invoice goes back to pending_cfo (CFO fields cleared) the next
-- time the team saves it through save_client_invoice — the same resubmit
-- flow as editing any other draft, no separate "resubmit" action needed.
create or replace function public.save_client_invoice(
  p_invoice_id uuid, p_project_id uuid, p_invoice_number text, p_invoice_date date,
  p_gst_rate numeric, p_gst_type text, p_subject text, p_remarks text, p_lines jsonb
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_old     public.client_invoices%rowtype;
  v_item    public.monitoring_items%rowtype;
  v_line    jsonb;
  v_amt     numeric;
  v_amount  numeric := 0;
  v_id      uuid;
  v_cap     record;
begin
  if not public.can_edit_monitoring_project(p_project_id) then
    raise exception 'You do not have permission to edit invoices on this project.';
  end if;

  if p_invoice_id is not null then
    select * into v_old from public.client_invoices where id = p_invoice_id and project_id = p_project_id;
    if not found then raise exception 'Invoice not found.'; end if;
    if v_old.status = 'paid' then raise exception 'A paid invoice can no longer be changed.'; end if;
    if v_old.status = 'raised' then raise exception 'This invoice has already been approved and signed by the CFO — it can no longer be edited.'; end if;
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
      subject = nullif(trim(coalesce(p_subject, '')), ''), remarks = nullif(trim(coalesce(p_remarks, '')), ''),
      status = case when v_old.status = 'rejected' then 'pending_cfo' else status end,
      cfo_decided_by = case when v_old.status = 'rejected' then null else cfo_decided_by end,
      cfo_decided_at = case when v_old.status = 'rejected' then null else cfo_decided_at end,
      cfo_remark = case when v_old.status = 'rejected' then null else cfo_remark end
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

