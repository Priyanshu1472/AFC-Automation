-- Cross-team query on a lead — a DGM/AGM who spots (now org-wide visible,
-- see 20260928000200) another team's lead they believe their own team
-- could run better raises a query with a justification; PMT triages it
-- (add the raiser to the lead's chat, decline it, or transfer the lead to
-- the raiser's team — see respond-lead-query / transfer-lead edge
-- functions). Every write goes through those service-role functions, same
-- convention as every other table in this module.

create table public.lead_queries (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  raised_by_id   uuid not null references public.afc_users(id),
  raised_by_team text not null,
  justification  text not null,
  status         text not null default 'open' check (status in ('open', 'added_to_chat', 'transferred', 'declined')),
  pmt_response   text,
  resolved_by_id uuid references public.afc_users(id),
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index lead_queries_lead_idx on public.lead_queries(lead_id);
create index lead_queries_status_idx on public.lead_queries(status);

alter table public.lead_queries enable row level security;

-- Same visibility as the lead itself, plus the raiser always (so they can
-- see their own query even if something later narrows can_view_lead for
-- them specifically — belt and suspenders, matches no other table's
-- pattern in this module but is cheap and harmless here).
create policy lead_queries_select on public.lead_queries
for select using (public.can_view_lead(lead_id) or raised_by_id = auth.uid());

-- No authenticated INSERT/UPDATE/DELETE policies — every write goes
-- through raise-lead-query / respond-lead-query, both service-role.

alter publication supabase_realtime add table public.lead_queries;
