-- "Add more Person Responsible" on a Lead — same idea as Proposals'
-- proposal_additional_responsibles (20261112000000), one stage earlier:
-- the lead's named Person Responsible, Reviewer or Recommending Authority
-- (or MD/Admin, or — once added — another additional responsible) can add
-- a teammate who then gets exactly the same lead access as the Person
-- Responsible. Unlike Proposals, Leads has no single can_edit_lead()
-- gate — every pipeline action (update-lead, advance-lead-stage,
-- update-lead-due-date, generate-lead-approval-note) hardcodes its own
-- `caller.id === lead.person_responsible_id` check, so granting real
-- parity means widening each of those too (done in the edge functions
-- themselves, not here) — this migration only adds the membership table,
-- its own narrow manage-gate, and widens can_view_lead() so an additional
-- responsible can see the lead at all.
create table public.lead_additional_responsibles (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  user_id    uuid not null references public.afc_users(id),
  added_by   uuid references public.afc_users(id),
  created_at timestamptz not null default now(),
  unique (lead_id, user_id)
);

create index lead_additional_responsibles_lead_idx on public.lead_additional_responsibles(lead_id);

alter table public.lead_additional_responsibles enable row level security;

-- Who may add/remove an additional responsible: the lead's named PR/
-- Reviewer/Recommending Authority, MD/Admin, or (once added) another
-- additional responsible themselves — same "do what PR can do" parity
-- this feature promises. Blocked once the lead is a dead end (dropped or
-- declined) — nothing left for an extra pair of hands to do. The actual
-- add/remove flow goes through add-lead-responsible/remove-lead-
-- responsible (service role), but this is what those functions' own
-- checks mirror, and what would gate a direct client write too.
create or replace function public.can_manage_lead_responsibles(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and l.status not in ('pa_dropped', 'md_declined')
      and (
        public.current_afc_role() in ('md', 'admin')
        or auth.uid() in (l.person_responsible_id, l.reviewer_id, l.recommending_authority_id)
        or exists (
          select 1 from public.lead_additional_responsibles x
          where x.lead_id = l.id and x.user_id = auth.uid()
        )
      )
  );
$$;

create policy lead_additional_responsibles_select on public.lead_additional_responsibles
for select using (public.can_view_lead(lead_id));

create policy lead_additional_responsibles_insert on public.lead_additional_responsibles
for insert with check (public.can_manage_lead_responsibles(lead_id));

create policy lead_additional_responsibles_delete on public.lead_additional_responsibles
for delete using (public.can_manage_lead_responsibles(lead_id));

-- Widen can_view_lead() once more — full body copied from
-- 20261124020000_can_view_lead_combined.sql with one new clause added, so
-- an additional responsible can open the lead at all, not just be
-- recognised by the function above.
create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm', 'general_manager')
        or public.has_committee('PMT')
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
        or exists (
          select 1
          from public.lead_additional_responsibles x
          where x.lead_id = l.id and x.user_id = auth.uid()
        )
        or (l.status = 'md_approved' and public.current_afc_role() <> 'business_associate')
      )
  );
$$;
