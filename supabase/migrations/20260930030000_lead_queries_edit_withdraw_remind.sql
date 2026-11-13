-- Lets the raiser of a still-open cross-team query (see 20260928000300)
-- edit their justification, withdraw it outright, or nudge PMT with a
-- reminder — all via update-lead-query (service-role, same convention as
-- raise-lead-query/respond-lead-query). A withdrawn query frees the raiser
-- up to raise a fresh one later (raise-lead-query's existingOpen check only
-- looks at status = 'open'), which is why this is a distinct status rather
-- than reusing 'declined' (that's PMT's call, not the raiser's).

alter table public.lead_queries
  add column edited_at  timestamptz,
  add column removed_at timestamptz;

alter table public.lead_queries drop constraint lead_queries_status_check;
alter table public.lead_queries add constraint lead_queries_status_check
  check (status in ('open', 'added_to_chat', 'transferred', 'declined', 'withdrawn'));
