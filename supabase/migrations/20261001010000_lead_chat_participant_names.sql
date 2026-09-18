-- Fix: lead chat showed "Unknown" for any sender not on the viewer's own
-- team (and not PMT/org-wide-visible) — LeadChatPanel.jsx resolves sender
-- names via an embedded PostgREST join (`sender:sender_id(full_name)`),
-- which is subject to afc_users' own SELECT RLS. Cross-team chat rosters
-- are normal here (advance-lead-stage adds the whole review chain —
-- creator/PR/reviewer/recommending authority/PMT/MD — to a lead's chat as
-- it moves through committees, and cross-team queries can add still more
-- people), so a plain team-scoped viewer (Project Officer, Associate
-- Consultant, Project Assistant, Area Manager, Regional Manager) routinely
-- can't see afc_users rows for teammates-in-chat who aren't on their team.
--
-- Deliberately NOT fixed by widening afc_users' row-level SELECT policy —
-- that table also carries pin_hash (a 4-digit action PIN's hash, trivially
-- brute-forced given the hash conveys nothing more), and a broad
-- "shared lead chat" RLS policy would let anyone construct their own
-- direct query for every column of a co-participant's row, not just the
-- full_name the UI actually needs. Instead: a narrow SECURITY DEFINER RPC
-- that returns only (user_id, full_name) for a given lead's chat roster,
-- and only to a caller who is themselves already a participant.
create or replace function public.get_lead_chat_participant_names(p_lead_id uuid)
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name
  from public.lead_chat_participants p
  join public.afc_users u on u.id = p.user_id
  where p.lead_id = p_lead_id
    and public.is_lead_chat_participant(p_lead_id);
$$;

revoke all on function public.get_lead_chat_participant_names(uuid) from public;
grant execute on function public.get_lead_chat_participant_names(uuid) to authenticated;

-- Same fix, same reasoning, for the Proposal chat (ProposalChatPanel.jsx
-- has the identical embedded-join-hits-RLS bug).
create or replace function public.get_proposal_chat_participant_names(p_proposal_id uuid)
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name
  from public.proposal_chat_participants p
  join public.afc_users u on u.id = p.user_id
  where p.proposal_id = p_proposal_id
    and public.is_proposal_chat_participant(p_proposal_id);
$$;

revoke all on function public.get_proposal_chat_participant_names(uuid) from public;
grant execute on function public.get_proposal_chat_participant_names(uuid) to authenticated;

-- Same fix again for LeadQueryPanel.jsx's raiser/resolver name lookups
-- (`raiser:raised_by_id(full_name)`, `resolver:resolved_by_id(full_name)`)
-- — cross-team queries are the whole point of this feature (a DGM/GM/AGM/
-- SRM from another team raising one), so the raiser is almost always
-- exactly the kind of cross-team profile a plain team-scoped viewer can't
-- otherwise read. Gated on the caller being able to see the lead itself
-- (the same condition that already gates seeing the query at all).
create or replace function public.get_lead_query_names(p_lead_id uuid)
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name
  from public.afc_users u
  where public.can_view_lead(p_lead_id)
    and u.id in (
      select raised_by_id from public.lead_queries where lead_id = p_lead_id
      union
      select resolved_by_id from public.lead_queries where lead_id = p_lead_id and resolved_by_id is not null
    );
$$;

revoke all on function public.get_lead_query_names(uuid) from public;
grant execute on function public.get_lead_query_names(uuid) to authenticated;
