-- A user can hold several committees at once (afc_user_committees is the
-- authoritative set; afc_users.committee is only the "primary" one, kept for
-- backward compatibility). Every database-side permission check below still
-- read the scalar column, so someone whose PMT or G3 membership was NOT
-- their primary committee (e.g. primary = Accounts, PMT added second) got
-- none of that committee's permissions. Each is re-pointed at the full set.
--
-- Bodies are copied from the latest definition of each object, with only the
-- committee check changed:
--   can_view_lead                  20261112000000_proposal_additional_responsibles
--   get_lead_chat_add_candidates   20261030040000_lead_chat_add_member
--   can_see_lead_query             20261030050000_lead_queries_private_to_pmt_md_raiser
--   afc_users_select_own_team_active  20260929000000_area_regional_..._roles
--   can_view_g3_escalation         20261102000000_lead_g3_escalation

-- ── Helpers ─────────────────────────────────────────────────────────
-- Security definer because afc_user_committees' own RLS only lets a user
-- read their own rows (and Admin everyone's).
create or replace function public.user_has_committee(p_user_id uuid, p_committee text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.afc_user_committees c
    where c.user_id = p_user_id and c.committee = p_committee
  );
$$;

create or replace function public.has_committee(p_committee text)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.user_has_committee(auth.uid(), p_committee);
$$;

revoke all on function public.user_has_committee(uuid, text) from public;
revoke all on function public.has_committee(text) from public;
grant execute on function public.user_has_committee(uuid, text) to authenticated, service_role;
grant execute on function public.has_committee(text) to authenticated, service_role;

-- ── can_view_lead ───────────────────────────────────────────────────
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
      )
  );
$$;

-- ── Lead chat "Add member" candidates (PMT only) ────────────────────
create or replace function public.get_lead_chat_add_candidates(p_lead_id uuid)
returns table (user_id uuid, full_name text, role text, team text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name, u.role, u.team, u.avatar_path
  from public.afc_users u
  where u.is_active
    and u.role in ('dgm', 'agm', 'srm', 'general_manager')
    and public.has_committee('PMT')
    and not exists (
      select 1 from public.lead_chat_participants p
      where p.lead_id = p_lead_id and p.user_id = u.id
    )
  order by u.full_name;
$$;

revoke all on function public.get_lead_chat_add_candidates(uuid) from public;
grant execute on function public.get_lead_chat_add_candidates(uuid) to authenticated;

-- ── Cross-team lead queries: PMT / MD / admin / the raiser ──────────
create or replace function public.can_see_lead_query(p_raised_by_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_raised_by_id = auth.uid()
    or public.current_afc_role() in ('md', 'admin')
    or public.has_committee('PMT');
$$;

revoke all on function public.can_see_lead_query(uuid) from public;
grant execute on function public.can_see_lead_query(uuid) to authenticated;

-- ── User directory: PMT members (primary or not) are visible to all ──
drop policy if exists afc_users_select_own_team_active on public.afc_users;
create policy afc_users_select_own_team_active on public.afc_users
for select using (
  is_active = true
  and (
    public.is_current_user_team(team)
    or committee = 'PMT'
    or public.user_has_committee(id, 'PMT')
    or public.has_committee('PMT')
    or public.current_afc_role() in ('md', 'admin', 'cfo', 'cs', 'dgm', 'agm', 'srm', 'general_manager')
  )
);

-- ── G3 escalation visibility ────────────────────────────────────────
create or replace function public.can_view_g3_escalation()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_afc_role() in ('md', 'admin')
    or public.has_committee('G3');
$$;

revoke all on function public.can_view_g3_escalation() from public;
grant execute on function public.can_view_g3_escalation() to authenticated;

-- ── G3 member picker for the "Escalate to G3" dialog ────────────────
-- The dialog used to read afc_users.committee = 'G3' directly, which misses
-- anyone whose G3 membership is a secondary committee, and a lead owner
-- can't read afc_user_committees to look them up. Same audience as the
-- escalate-lead-to-g3 edge function, which re-validates the picks itself.
create or replace function public.get_g3_escalation_candidates()
returns table (id uuid, full_name text, team text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name, u.team
  from public.afc_users u
  where u.is_active
    and public.user_has_committee(u.id, 'G3')
    and auth.uid() is not null
  order by u.full_name;
$$;

revoke all on function public.get_g3_escalation_candidates() from public;
grant execute on function public.get_g3_escalation_candidates() to authenticated;
