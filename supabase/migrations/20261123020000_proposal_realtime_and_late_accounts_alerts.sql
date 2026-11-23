-- 1) Live updates on the Proposal page.
--    The page subscribes to these tables, but most were never added to the
--    supabase_realtime publication, so nobody else's screen changed until a
--    manual refresh (e.g. Accounts marks the fee note paid and the Person
--    Responsible still sees "Mark Payment Done").
do $$
declare
  t text;
begin
  foreach t in array array[
    'proposal_preparations', 'fee_notes', 'proposal_documents', 'proposal_activity',
    'proposal_additional_responsibles', 'proposal_document_requests'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 2) Someone added to the Accounts Committee after the MD already approved a
--    Bid Payment Requisition Note never got its "payment due" alert (it is
--    sent only to whoever was a member at approval time). When a member is
--    added, give them the alert for every approved-but-unpaid note and add
--    them to that proposal's chat, same as decide-fee-note-md does.
create or replace function public.notify_new_accounts_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.committee <> 'Accounts' then
    return new;
  end if;
  if not exists (select 1 from afc_users where id = new.user_id and is_active) then
    return new;
  end if;

  insert into notifications (user_id, title, sub_text, type, link, kind)
  select new.user_id,
         'Bid Payment Requisition Note approved — payment due',
         l.lead_number || ' — "' || l.title || '": the MD approved the Bid Payment Requisition Note. Check the signatures and make the payment.',
         'action_required',
         '/proposals/' || l.id,
         'proposal_accounts'
  from fee_notes f
  join proposal_preparations p on p.id = f.proposal_id
  join leads l on l.id = p.lead_id
  where f.status = 'approved'
    and f.payment_status <> 'paid'
    and not exists (
      select 1 from notifications n
      where n.user_id = new.user_id and n.link = '/proposals/' || l.id
        and n.kind = 'proposal_accounts' and not n.is_read
    );

  insert into proposal_chat_participants (proposal_id, user_id, role_at_add)
  select distinct f.proposal_id, new.user_id, 'accounts'
  from fee_notes f
  where f.status = 'approved' and f.payment_status <> 'paid'
  on conflict (proposal_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists afc_user_committees_notify_accounts on public.afc_user_committees;
create trigger afc_user_committees_notify_accounts
  after insert on public.afc_user_committees
  for each row execute function public.notify_new_accounts_member();

-- One-off: anyone already in Accounts who is missing an unread alert for a
-- note still waiting on payment.
insert into notifications (user_id, title, sub_text, type, link, kind)
select c.user_id,
       'Bid Payment Requisition Note approved — payment due',
       l.lead_number || ' — "' || l.title || '": the MD approved the Bid Payment Requisition Note. Check the signatures and make the payment.',
       'action_required',
       '/proposals/' || l.id,
       'proposal_accounts'
from afc_user_committees c
join afc_users u on u.id = c.user_id and u.is_active
cross join fee_notes f
join proposal_preparations p on p.id = f.proposal_id
join leads l on l.id = p.lead_id
where c.committee = 'Accounts'
  and f.status = 'approved'
  and f.payment_status <> 'paid'
  and not exists (
    select 1 from notifications n
    where n.user_id = c.user_id and n.link = '/proposals/' || l.id
      and n.kind = 'proposal_accounts'
  );
