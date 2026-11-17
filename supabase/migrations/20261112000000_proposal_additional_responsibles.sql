-- "Add more Person Responsible" on a Proposal: the lead's existing Person
-- Responsible, Reviewer or Recommending Authority can add another team
-- member who then gets exactly the same proposal access as the Person
-- Responsible — fee notes, BP document requests, proposal documents, the
-- AFC checklist, the proposal's own chat, locking, etc. Every one of those
-- already gates writes through can_edit_proposal() and reads through
-- can_view_proposal() -> can_view_lead(), so widening those two functions
-- below is the only change needed to grant full parity everywhere at
-- once — no policy duplication across the six other proposal-prep tables.
create table public.proposal_additional_responsibles (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposal_preparations(id) on delete cascade,
  user_id      uuid not null references public.afc_users(id),
  added_by     uuid references public.afc_users(id),
  created_at   timestamptz not null default now(),
  unique (proposal_id, user_id)
);

create index proposal_additional_responsibles_proposal_idx on public.proposal_additional_responsibles(proposal_id);

alter table public.proposal_additional_responsibles enable row level security;

-- Visible to anyone who can already see the proposal.
create policy proposal_additional_responsibles_select on public.proposal_additional_responsibles
for select using (public.can_view_proposal(proposal_id));

-- Added/removed by anyone who already has edit rights on the proposal —
-- the lead's own PR/Reviewer/Recommending Authority, MD/Admin, or (once
-- added) an additional responsible themselves — the same "do what PR can
-- do" parity this feature promises. The actual add/remove flow goes
-- through the add-proposal-responsible/remove-proposal-responsible edge
-- functions (so the chat roster and a notification stay in sync), but
-- these policies are what those functions' own admin-client writes rely
-- on being correct in principle, and what would gate a direct client
-- write too.
create policy proposal_additional_responsibles_insert on public.proposal_additional_responsibles
for insert with check (public.can_edit_proposal(proposal_id));

create policy proposal_additional_responsibles_delete on public.proposal_additional_responsibles
for delete using (public.can_edit_proposal(proposal_id));

-- Re-point can_edit_proposal() to also recognise an additional
-- responsible — every write policy across fee_notes, proposal_documents,
-- proposal_document_requests, proposal_afc_checklist_items and their
-- version-history tables all gate through this one function.
create or replace function public.can_edit_proposal(p_proposal_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.proposal_preparations pp
    join public.leads l on l.id = pp.lead_id
    where pp.id = p_proposal_id
      and not pp.locked
      and (l.submission_deadline is null or l.submission_deadline >= current_date)
      and (
        public.current_afc_role() in ('md', 'admin')
        or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id)
        or exists (
          select 1 from public.proposal_additional_responsibles par
          where par.proposal_id = pp.id and par.user_id = auth.uid()
        )
      )
  );
$$;

-- can_view_lead() is what ProposalPreparationPage's own `leads` select, and
-- can_view_proposal() (which every proposal-prep SELECT policy ultimately
-- calls), both rely on — widened so an additional responsible can open the
-- lead and proposal at all, not just write to it. Full body copied from
-- 20261104000000_g3_assignee_lead_visibility.sql with one new clause added.
create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm', 'general_manager')
        or exists (select 1 from public.afc_users u where u.id = auth.uid() and u.committee = 'PMT')
        or (auth.uid() = l.created_by and public.is_current_user_team(l.team))
        or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id, l.handled_by_dgm_id)
        or (
          public.current_afc_role() in ('project_officer', 'area_manager', 'regional_manager', 'associate_consultant', 'project_assistant')
          and public.is_current_user_team(l.team)
        )
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
        or exists (
          select 1
          from public.lead_g3_escalation_members m
          join public.lead_g3_escalation_assignees a on a.escalation_id = m.escalation_id
          where m.lead_id = l.id and a.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.proposal_preparations pp
          join public.proposal_additional_responsibles par on par.proposal_id = pp.id
          where pp.lead_id = l.id and par.user_id = auth.uid()
        )
      )
  );
$$;
