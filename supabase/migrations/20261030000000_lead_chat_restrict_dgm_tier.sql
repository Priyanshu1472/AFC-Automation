-- Lead chat was visible to anyone who could view the lead at all
-- (lead_chat_messages_select / lead_chat_participants_select both OR'd in
-- can_view_lead(lead_id)) — and can_view_lead() grants dgm/agm/
-- general_manager/srm visibility into EVERY lead org-wide, not just their
-- own team's, as an oversight-tier role check. That blanket clause was
-- fine for seeing the lead itself, but it also let any DGM/AGM/GM/SRM read
-- the full chat history of a lead they were never added to, on any team —
-- not the intent documented in 20260825030000_lead_chat.sql (committee
-- members keep chat access after can_view_lead's per-stage clause moves on
-- — that reasoning only ever applied to the PMT-committee/role clauses
-- that ARE team- or stage-scoped, not to this one).
--
-- Fix: these four roles now see a lead's chat only once actually added to
-- lead_chat_participants (advance-lead-stage adds the lead's own DGM/AGM/
-- GM "on forward-to-DGM" — i.e. once PMT has actually looped them in),
-- never merely by holding the role. Every other can_view_lead() path
-- (MD/CFO/CS/admin, PMT committee, the lead's own PR/Reviewer/Recommending
-- Authority, team-scoped PO/AM/RM/AC/PA, the assigned BA) is unaffected.

create or replace function public.can_view_lead_chat(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_lead_chat_participant(p_lead_id)
    or (
      public.can_view_lead(p_lead_id)
      and public.current_afc_role() not in ('dgm', 'agm', 'general_manager', 'srm')
    );
$$;

revoke all on function public.can_view_lead_chat(uuid) from public;
grant execute on function public.can_view_lead_chat(uuid) to authenticated;

drop policy if exists lead_chat_participants_select on public.lead_chat_participants;
create policy lead_chat_participants_select on public.lead_chat_participants
for select using (public.can_view_lead_chat(lead_id));

drop policy if exists lead_chat_messages_select on public.lead_chat_messages;
create policy lead_chat_messages_select on public.lead_chat_messages
for select using (public.can_view_lead_chat(lead_id));
