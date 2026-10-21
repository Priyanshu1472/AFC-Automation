-- Deliverable form changes:
--   * invoice_pct — the % of contract value entered in the Add Deliverable
--     form; invoice_amount (already governed by monitoring_items_amount_guard)
--     stays the source of truth, this is just what's shown back ("10% ·
--     ₹10,00,000") and lets the form recompute the amount if the contract
--     value changes later. Milestones don't use it (still enter a raw
--     amount) — nullable, no guard of its own.
--   * remarks — a free-form note editable any time after creation, separate
--     from completion_note (which only exists once an item is marked
--     complete) and from description (the scope/acceptance criteria set at
--     creation).
--   * Every deliverable now always alerts the team to invoice on
--     completion — the per-item checkbox is gone from the UI, so this
--     backfills existing rows to match (milestones are unaffected; they
--     keep the checkbox and whatever they were already set to).
alter table public.monitoring_items add column invoice_pct numeric(5,2) check (invoice_pct is null or (invoice_pct >= 0 and invoice_pct <= 100));
alter table public.monitoring_items add column remarks text;

update public.monitoring_items set invoice_on_completion = true where kind = 'deliverable' and invoice_on_completion = false;

-- monitoring_documents can now optionally attach to one milestone/
-- deliverable (shown on that item's card, as well as in the project's
-- Documents tab) instead of only ever being project-wide.
alter table public.monitoring_documents add column item_id uuid references public.monitoring_items(id) on delete set null;
alter table public.monitoring_documents drop constraint monitoring_documents_category_check;
alter table public.monitoring_documents add constraint monitoring_documents_category_check
  check (category in ('mou_client', 'mou_bp', 'work_order', 'client_document', 'deliverable', 'other'));

create or replace function public.monitoring_documents_before_write()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null and not exists (
    select 1 from public.monitoring_items i where i.id = new.item_id and i.project_id = new.project_id
  ) then
    raise exception 'The linked milestone/deliverable belongs to a different project.';
  end if;
  return new;
end;
$$;

create trigger monitoring_documents_before_write
  before insert or update on public.monitoring_documents
  for each row execute function public.monitoring_documents_before_write();
