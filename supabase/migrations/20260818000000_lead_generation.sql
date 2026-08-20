-- In-House Lead Generation module (RFP lead type). See plan doc for the full
-- design rationale. Mirrors the empanelment module's security model: no
-- INSERT/UPDATE/DELETE policies for `authenticated` anywhere here — every
-- write goes through a service-role edge function
-- (create-lead/update-lead/advance-lead-stage/manage-lead-role).
--
-- Lead-Gen roles (pa/project_officer/associate_consultant/agm/pmt/
-- pmt_extended/dgm/md) are a separate, admin-managed, many-to-many tag
-- system (lead_role_assignments) — deliberately independent of afc_users.role,
-- which stays the single HR role used by Empanelment/Knowledge Repository.

-- ── Lead-Gen role tags ─────────────────────────────────────────────
create table public.lead_role_assignments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.afc_users(id),
  role         text not null check (role in (
                 'pa','project_officer','associate_consultant','agm',
                 'pmt','pmt_extended','dgm','md'
               )),
  -- Team-scoped for every role except 'md' (org-wide, so team must be null).
  team         text,
  assigned_by  uuid not null references public.afc_users(id),
  created_at   timestamptz not null default now(),
  check ((role = 'md' and team is null) or (role <> 'md' and team is not null))
);

-- A plain `unique (user_id, role, team)` wouldn't actually stop a duplicate
-- 'md' grant — Postgres treats NULL <> NULL, and every 'md' row has
-- team = null. coalesce() to '' sidesteps that (team is never really '').
create unique index lead_role_assignments_unique_idx on public.lead_role_assignments (user_id, role, coalesce(team, ''));
create index lead_role_assignments_user_idx on public.lead_role_assignments(user_id);
create index lead_role_assignments_role_team_idx on public.lead_role_assignments(role, team);

-- ── Leads ───────────────────────────────────────────────────────────
create sequence if not exists public.lead_number_seq;

create or replace function public.next_lead_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'LH-' || extract(year from now())::text || '-' || lpad(nextval('lead_number_seq')::text, 6, '0');
$$;
-- Not granted to `authenticated` — only ever called from create-lead via the
-- service-role client, so a normal user can't burn sequence values by
-- probing the RPC directly.

create table public.leads (
  id                      uuid primary key default gen_random_uuid(),
  lead_number             text not null unique,

  lead_type               text not null default 'rfp' check (lead_type in ('rfp', 'eoi')),
  source                  text not null default 'in_house' check (source in ('in_house', 'ba', 'suo_moto')),

  title                   text not null,
  portal_name             text,
  bid_number              text,
  client_name             text,
  state                   text,
  submission_deadline     date,
  delivery_type           text check (delivery_type in ('online', 'offline', 'both')),
  remark                  text,
  -- [{name, path, size, uploaded_at}] — path is a private storage object
  -- path in the `lead-documents` bucket, never a public URL.
  documents               jsonb not null default '[]',

  team                    text not null,
  created_by              uuid not null references public.afc_users(id),
  person_responsible_id   uuid not null references public.afc_users(id),
  reviewer_id             uuid not null references public.afc_users(id),
  approval_authority_id   uuid not null references public.afc_users(id),
  assigned_ba_id          uuid references public.afc_users(id),
  -- Set when a DGM actually acts (org-wide pool at dgm_review) — not
  -- pre-assigned at creation, unlike reviewer_id/approval_authority_id.
  handled_by_dgm_id       uuid references public.afc_users(id),

  status                  text not null default 'pa_review' check (status in (
                            'pa_review', 'pmt_review', 'pmt_extended_review', 'dgm_review', 'md_review',
                            'pa_action_required', 'pa_dropped', 'md_approved', 'md_declined'
                          )),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  submitted_at            timestamptz not null default now(),
  decided_at              timestamptz
);

create index leads_status_idx                 on public.leads(status);
create index leads_team_idx                   on public.leads(team);
create index leads_created_by_idx             on public.leads(created_by);
create index leads_person_responsible_idx     on public.leads(person_responsible_id);
create index leads_reviewer_idx               on public.leads(reviewer_id);
create index leads_approval_authority_idx     on public.leads(approval_authority_id);
create index leads_handled_by_dgm_idx         on public.leads(handled_by_dgm_id);

create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

-- ── Activity log (append-only) ────────────────────────────────────
create table public.lead_activity_log (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  actor_id     uuid references public.afc_users(id),
  actor_role   text not null,
  action       text not null,
  from_status  text,
  to_status    text,
  comment      text,
  created_at   timestamptz not null default now()
);

create index lead_activity_log_lead_idx on public.lead_activity_log(lead_id);

-- ── Duplicate detection ────────────────────────────────────────────
-- SQL mirrors of normLeadText/leadTokens in src/lib/portal_table.js — keep
-- the stopword list in sync with that file if it changes.
create or replace function public.afc_norm_lead_text(t text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.afc_lead_tokens(t text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(w), '{}')
  from unnest(string_to_array(public.afc_norm_lead_text(t), ' ')) as w
  where length(w) > 1
    and w <> all (array[
      'request','requests','for','proposal','proposals','rfp','rfps',
      'eoi','eois','expression','expressions','interest','tender',
      'tenders','notice','notices','inviting','invitation','nit',
      'bid','bids','bidding','document','documents','doc',
      'ref','reference','no','nos','number',
      'of','and','the','to','a','an','on','in','at','by','with',
      'from','or','as','is','are','shall','be'
    ]);
$$;

-- Deliberately scoped to the caller's own team only (not org-wide) — the one
-- intentional narrow exception to RLS in this module, to let duplicate
-- detection see teammates' leads (e.g. another PA's) without broadening
-- general read access. Returns only lead_number/title/status/score, never
-- full lead details.
create or replace function public.find_similar_leads(
  p_title text,
  p_team text,
  p_bid_number text default null,
  p_document_name text default null,
  p_document_size bigint default null
)
returns table(id uuid, lead_number text, title text, status text, score numeric)
language sql
stable
security definer
set search_path = public
as $$
  -- `x = any(subquery)` and `x = any(function_call)` parse differently in
  -- Postgres: a bare subquery on the right of ANY is read as "row-set"
  -- form (each row must match x's own type), not "array" form — even
  -- though afc_lead_tokens() returns text[]. Calling the function
  -- directly (no CTE/subquery wrapper) keeps it unambiguously the array
  -- form, so it's called inline rather than hoisted into a CTE.
  with scored as (
    select
      l.id, l.lead_number, l.title, l.status,
      greatest(
        case when p_bid_number is not null and l.bid_number is not null
              and lower(l.bid_number) = lower(p_bid_number) then 1.0 else 0 end,
        case when p_document_name is not null and p_document_size is not null
              and exists (
                select 1 from jsonb_array_elements(l.documents) d
                where d->>'name' = p_document_name
                  and (d->>'size')::bigint = p_document_size
              ) then 1.0 else 0 end,
        coalesce((
          select count(*)::numeric
          from unnest(public.afc_lead_tokens(l.title)) t
          where t = any (public.afc_lead_tokens(p_title))
        ) / nullif(greatest(
          array_length(public.afc_lead_tokens(l.title), 1),
          array_length(public.afc_lead_tokens(p_title), 1)
        ), 0), 0)
      ) as score
    from public.leads l
    where l.team = p_team
  )
  select id, lead_number, title, status, score
  from scored
  where score >= 0.3
  order by score desc
  limit 5;
$$;

revoke all on function public.find_similar_leads(text, text, text, text, bigint) from public;
grant execute on function public.find_similar_leads(text, text, text, text, bigint) to authenticated;

-- ── Storage ─────────────────────────────────────────────────────
-- Private bucket, same convention as ba-documents — no storage.objects RLS
-- policies for authenticated/anon, every read/write goes through a
-- service-role edge function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-documents', 'lead-documents', false, 10485760,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

-- ── afc_users — narrow additional visibility for Lead Generation ──
-- Mirrors afc_users_select_team_reviewers (20260717170000): the existing
-- afc_users RLS only allows your own row, org-wide read for md/cfo/cs/admin,
-- and a dgm reading their own team. The lead form needs to show the name of
-- anyone it lets you pick (Person Responsible/Reviewer/Approval Authority,
-- and optionally a Business Associate) — these narrow policies expose only
-- what's needed for that, nothing else about teammates.
drop policy if exists afc_users_select_lead_gen_teammates on public.afc_users;
create policy afc_users_select_lead_gen_teammates on public.afc_users
for select using (
  is_active = true
  and exists (
    select 1 from public.lead_role_assignments r
    where r.user_id = afc_users.id
      and (r.team = public.current_afc_team() or r.role = 'md')
  )
);

drop policy if exists afc_users_select_business_associates on public.afc_users;
create policy afc_users_select_business_associates on public.afc_users
for select using (role = 'business_associate' and is_active = true);

-- ── RLS ─────────────────────────────────────────────────────────
alter table public.lead_role_assignments enable row level security;
alter table public.leads                 enable row level security;
alter table public.lead_activity_log     enable row level security;

-- Admin sees every assignment (needed to manage them); anyone can see who
-- holds 'md' (org-wide, useful for display) or their own rows (needed even
-- if a tag's team differs from their afc_users.team); otherwise scoped to
-- the caller's own team so the create-lead form can populate its dropdowns.
create policy lead_role_assignments_select on public.lead_role_assignments
for select using (
  public.current_afc_role() = 'admin'
  or role = 'md'
  or user_id = auth.uid()
  or team = public.current_afc_team()
);

create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (
        public.current_afc_role() in ('md', 'admin')
        or exists (
          select 1 from public.lead_role_assignments r
          where r.user_id = auth.uid() and r.team = l.team
        )
        or (
          l.status = 'dgm_review'
          and exists (
            select 1 from public.lead_role_assignments r
            where r.user_id = auth.uid() and r.role = 'dgm'
          )
        )
        or auth.uid() in (l.created_by, l.person_responsible_id, l.reviewer_id, l.approval_authority_id, l.handled_by_dgm_id)
        or (public.current_afc_role() = 'business_associate' and l.assigned_ba_id = auth.uid())
      )
  );
$$;

create policy leads_select on public.leads
for select using (public.can_view_lead(id));

create policy lead_activity_log_select on public.lead_activity_log
for select using (public.can_view_lead(lead_id));

-- ── Realtime ────────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.leads,
  public.lead_activity_log;
