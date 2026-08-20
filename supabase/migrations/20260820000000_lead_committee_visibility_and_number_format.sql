-- Two independent fixes to the Lead Generation module:
--
-- 1. Committee visibility gap: afc_users_select_own_team_active
--    (20260819010000) only exposed a target row when it matched the
--    CALLER's own team, or when the TARGET itself was a committee member.
--    A PMT/PMT Extended/G3 reviewer looking at a lead from a team that
--    isn't their own therefore couldn't see the creator's or the person
--    responsible's name (both ordinary, non-committee users) — the join in
--    LeadListPage/LeadDetailPage silently came back null. Committees are
--    org-wide by design, so a committee member needs org-wide read on
--    afc_users, not just team-scoped. current_afc_committee() mirrors the
--    existing current_afc_role()/current_afc_team() SECURITY DEFINER
--    pattern (a plain subquery here would recurse into afc_users' own
--    policies). The original target-is-committee-member clause is kept —
--    it's what lets a non-committee creator see e.g. which G3 DGM handled
--    their lead.
--
-- 2. Lead number format: "AFC/Lead/<year>/<seq>" replaces "LH-<year>-<seq>",
--    per product decision. The underlying sequence is untouched (existing
--    lead numbers already issued keep their old format; only the format for
--    numbers issued from now on changes) — only the string template inside
--    next_lead_number() changes.

create or replace function public.current_afc_committee()
returns text
language sql stable security definer set search_path = public as $$
  select committee from public.afc_users where id = auth.uid();
$$;

drop policy if exists afc_users_select_own_team_active on public.afc_users;
create policy afc_users_select_own_team_active on public.afc_users
for select using (
  is_active = true
  and (
    team = public.current_afc_team()
    or committee in ('PMT', 'PMT Extended', 'G3')
    or public.current_afc_committee() in ('PMT', 'PMT Extended', 'G3')
  )
);

create or replace function public.next_lead_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'AFC/Lead/' || extract(year from now())::text || '/' || lpad(nextval('lead_number_seq')::text, 3, '0');
$$;
