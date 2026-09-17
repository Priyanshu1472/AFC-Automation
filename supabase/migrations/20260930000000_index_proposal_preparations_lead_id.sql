-- proposal_preparations was originally deployed straight to the shared dev
-- database outside git (see 20260820040000_proposal_preparation_schema.sql's
-- own header comment), so there's no migration-tracked index on its
-- lead_id FK — the column every Proposals-module query filters/joins on
-- (ProposalsListPage.jsx's main list query, every satellite table's own
-- lead_id lookups). `if not exists` makes this safe to apply regardless of
-- whether the live database already happens to have one.
create index if not exists proposal_preparations_lead_id_idx
  on public.proposal_preparations(lead_id);
