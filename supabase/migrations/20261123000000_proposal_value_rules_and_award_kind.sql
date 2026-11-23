-- Proposals, 2026-11-23:
--
--  1. Proposed value is no longer always mandatory.
--     - RFP / Suo Moto lead: still required before locking.
--     - EOI lead: optional.
--     - "Empanelment only" tender (any lead type): no proposed value at all —
--       new proposal_preparations.empanelment_only flag, set by the team.
--
--  2. What "Awarded" means (proposal_preparations.award_kind):
--     - 'project'     the work itself was won -> Monitoring project opens.
--     - 'next_stage'  EOI only: shortlisted, the client will follow up with an
--                     RFP / tender. No deliverables or milestones, so no
--                     Monitoring project.
--     - 'empanelled'  an empanelment-only tender was won. No Monitoring project.
--     Null while the response is pending or rejected.
--
--  3. Additional Persons Responsible get the same rights as the named Person
--     Responsible for the proposed value (they already could lock and record
--     the result in the UI; the server now agrees, see lock-proposal /
--     set-proposal-outcome).

alter table public.proposal_preparations
  add column if not exists empanelment_only boolean not null default false,
  add column if not exists award_kind text;

alter table public.proposal_preparations drop constraint if exists proposal_preparations_award_kind_check;
alter table public.proposal_preparations add constraint proposal_preparations_award_kind_check
  check (award_kind is null or award_kind in ('project', 'next_stage', 'empanelled'));

-- Every proposal already marked awarded was a project award.
update public.proposal_preparations
set award_kind = 'project'
where client_response = 'awarded' and award_kind is null;

-- ── Proposed value: team incl. additional PRs; null clears it ───────
create or replace function public.set_proposal_proposed_value(p_proposal_id uuid, p_value numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_locked boolean;
  v_empanelment_only boolean;
begin
  select pp.locked, pp.empanelment_only into v_locked, v_empanelment_only
  from public.proposal_preparations pp
  where pp.id = p_proposal_id;

  if not found then raise exception 'Proposal not found.'; end if;
  if v_locked then raise exception 'This proposal is locked — the proposed value can no longer be changed.'; end if;
  if not public.is_proposal_team_member(p_proposal_id) then
    raise exception 'You do not have access to this proposal.';
  end if;
  if v_empanelment_only and p_value is not null then
    raise exception 'This proposal is marked Empanelment only, so it has no proposed value.';
  end if;
  if p_value is not null and p_value <= 0 then raise exception 'Enter a proposed value greater than zero.'; end if;

  update public.proposal_preparations
  set proposed_value = case when p_value is null then null else round(p_value, 2) end,
      proposed_value_updated_at = now(),
      proposed_value_updated_by = auth.uid()
  where id = p_proposal_id;
end;
$$;
revoke all on function public.set_proposal_proposed_value(uuid, numeric) from public;
grant execute on function public.set_proposal_proposed_value(uuid, numeric) to authenticated, service_role;

-- ── Empanelment only on/off (clears the proposed value when turned on) ──
create or replace function public.set_proposal_empanelment_only(p_proposal_id uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_locked boolean;
begin
  select pp.locked into v_locked from public.proposal_preparations pp where pp.id = p_proposal_id;
  if not found then raise exception 'Proposal not found.'; end if;
  if v_locked then raise exception 'This proposal is locked and can no longer be changed.'; end if;
  if not public.is_proposal_team_member(p_proposal_id) then
    raise exception 'You do not have access to this proposal.';
  end if;

  update public.proposal_preparations
  set empanelment_only = coalesce(p_on, false),
      proposed_value = case when coalesce(p_on, false) then null else proposed_value end,
      proposed_value_updated_at = case when coalesce(p_on, false) then now() else proposed_value_updated_at end,
      proposed_value_updated_by = case when coalesce(p_on, false) then auth.uid() else proposed_value_updated_by end
  where id = p_proposal_id;
end;
$$;
revoke all on function public.set_proposal_empanelment_only(uuid, boolean) from public;
grant execute on function public.set_proposal_empanelment_only(uuid, boolean) to authenticated, service_role;

-- ── Monitoring opens only for a project award ───────────────────────
create or replace function public.open_monitoring_on_award()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid;
  v_title text;
begin
  if new.client_response = 'awarded'
     and old.client_response is distinct from 'awarded'
     and coalesce(new.award_kind, 'project') = 'project' then
    insert into public.monitoring_projects (proposal_id, lead_id, contract_value)
    values (new.id, new.lead_id, new.proposed_value)
    on conflict do nothing
    returning id into v_project_id;

    if v_project_id is not null then
      select title into v_title from public.leads where id = new.lead_id;
      perform public.notify_monitoring_team(
        v_project_id,
        'Proposal awarded — set up monitoring',
        coalesce(v_title, 'Project') || ': upload the MoUs / work order and add milestones and deliverables.',
        '/monitoring/' || v_project_id
      );
    end if;
  end if;
  return new;
end;
$$;
