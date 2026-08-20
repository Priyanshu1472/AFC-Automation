-- Reconciles a naming collision with a separate, more expansive module
-- (Lead Conversion / Committees / Proposal Preparation / Fee Notes) that
-- has been applied directly to the afc-automation-dev database on multiple
-- occasions, each time outside of this repository's git history, and each
-- time creating its own `public.leads` table with a different schema than
-- this module's.
--
-- Per explicit product decision, THIS module (the from-scratch In-House
-- Lead Generation design in 20260818000000_lead_generation.sql onward) is
-- the one to keep — but the other module's own tables
-- (committees/committee_members/lead_assignment_requests/lead_conversions/
-- lead_conversion_events/lead_conversion_otps/proposal_*/fee_note_*) and
-- its utility functions are explicitly left untouched here: they may be
-- real, separate work this repo doesn't have visibility into, and none of
-- them actually collides by name with anything below except `leads` itself
-- (their lead_conversions/proposal_*/fee_note_* tables reference their
-- `leads` by id — cascading a drop through that chain would destroy them
-- for no reason). Instead, only the one colliding table is renamed out of
-- the way, and only the 4 functions whose exact behavior is specific to
-- *this* leads schema are replaced.

-- Clear out any leftover from a previous collision cycle, then rename
-- whatever currently occupies `public.leads` (the other module's table, if
-- present) out of the way so this module's own `leads` can be created
-- fresh under that name. Renaming a TABLE does not rename its indexes or
-- constraints in Postgres (index/constraint names stay schema-global) —
-- so leads_pkey, leads_status_idx, etc. would otherwise still sit under
-- their original names post-rename and collide with this module's own
-- same-named objects one at a time. Renaming every index first (which
-- covers the primary key and unique-constraint-backing indexes too, since
-- those are indexes) avoids that whack-a-mole.
drop table if exists public.legacy_lead_generation_leads cascade;

do $$
declare
  r record;
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'leads') then
    for r in select indexname from pg_indexes where schemaname = 'public' and tablename = 'leads' loop
      execute format('alter index public.%I rename to legacy_%s', r.indexname, r.indexname);
    end loop;
    alter table public.leads rename to legacy_lead_generation_leads;
  end if;
end $$;

-- Specifying the exact signature (rather than dropping by bare name) turned
-- out to be required, not just cautious: the other module also has a
-- find_similar_leads with a different signature, making the bare name
-- ambiguous. Targeting the precise signature ensures this only ever
-- touches *this* module's own overload, never theirs.
drop function if exists public.can_view_lead(uuid) cascade;
drop function if exists public.find_similar_leads(text, text, text, text, bigint) cascade;
drop function if exists public.afc_lead_tokens(text) cascade;
drop function if exists public.afc_norm_lead_text(text) cascade;
