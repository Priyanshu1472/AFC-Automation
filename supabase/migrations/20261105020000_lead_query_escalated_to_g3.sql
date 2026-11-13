-- A cross-team query raised on a lead that's at pmt_review can now be
-- resolved by forwarding it straight into a G3 escalation (see
-- escalate-lead-to-g3's new optional query_id) instead of only Add to
-- Chat / Forward to MD. Needs a terminal-ish status of its own so the
-- query stops showing as "open" once that happens.

alter table public.lead_queries drop constraint lead_queries_status_check;
alter table public.lead_queries add constraint lead_queries_status_check
  check (status in ('open', 'added_to_chat', 'transfer_pending', 'transferred', 'declined', 'withdrawn', 'escalated_to_g3'));
