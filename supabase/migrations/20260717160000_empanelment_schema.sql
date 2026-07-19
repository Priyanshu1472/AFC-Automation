-- Empanelment pipeline: applications, BA-submitted form data, per-application
-- activity log, and field-level compliance flags (hold/correction flow).
--
-- Security model: every write to these tables goes through a service-role
-- edge function with explicit role+status authorization (see supabase/
-- functions/{send-empanelment-invite,submit-ba-form,advance-empanelment-stage,
-- raise-empanelment-hold,submit-empanelment-correction}). No INSERT/UPDATE/
-- DELETE policies exist for `authenticated` on any table here — same
-- convention as afc_users / application_audit_log.

create table public.empanelment_applications (
  id                  uuid primary key default gen_random_uuid(),
  application_code    text not null unique,
  status              text not null default 'sent' check (status in (
                        'sent','filled','po_review','cfo_cs_review','po_final_review',
                        'dgm_review','md_review','accepted','rejected','on_hold'
                      )),
  ba_email            text not null,
  team                text not null,
  office              text not null,
  sent_by             uuid not null references public.afc_users(id),
  project_officer_id  uuid not null references public.afc_users(id),
  dgm_id              uuid references public.afc_users(id),
  po_comment          text,
  po_final_comment    text,
  cfo_comment         text,
  cfo_reviewed        boolean not null default false,
  cs_comment          text,
  cs_reviewed         boolean not null default false,
  dgm_comment         text,
  md_remarks          text,
  sent_at             timestamptz not null default now(),
  form_submitted_at   timestamptz,
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index empanelment_applications_status_idx on public.empanelment_applications(status);
create index empanelment_applications_team_idx   on public.empanelment_applications(team);
create index empanelment_applications_po_idx     on public.empanelment_applications(project_officer_id);
create index empanelment_applications_dgm_idx    on public.empanelment_applications(dgm_id);
create index empanelment_applications_sent_by_idx on public.empanelment_applications(sent_by);

create trigger empanelment_applications_set_updated_at
before update on public.empanelment_applications
for each row execute function public.set_updated_at();

-- BA-submitted form data, 1:1 with an application. Updated in place when a
-- flagged field is corrected (see compliance_flags below) — old/new values
-- for a correction are snapshotted onto the flag row, not versioned here.
create table public.ba_registrations (
  id                     uuid primary key default gen_random_uuid(),
  application_id         uuid not null unique references public.empanelment_applications(id) on delete cascade,

  org_name               text not null,
  entity_type            text not null,
  entity_type_other      text,
  year_established       integer not null,
  cin                    text,
  reg_address            text not null,
  branch_address         text,
  contact_person         text not null,
  designation            text not null,
  phone                  text not null,
  email                  text not null,
  website                text,

  pan                    text not null,
  gst                    text,
  msme_no                text,
  companies_act_status   text not null,
  company_status         text not null,
  date_of_incorporation  date not null,
  last_bs_filed          date,
  authorised_capital     numeric,
  paidup_capital         numeric,
  director_kyc           text,

  net_worth              jsonb not null default '{}',
  turnover               jsonb not null default '{}',
  pat                    jsonb not null default '{}',
  cash_flow              jsonb not null default '{}',
  working_capital_ratio  text,
  ca_firm_name           text,
  ca_reg_no              text,

  core_expertise         text not null,
  sectors_served         jsonb not null default '[]',
  other_sectors          text,
  team_size              integer,
  years_experience       integer,
  assignments            jsonb not null default '[]',

  certifications         text,
  govt_empanelments      text,

  bank_name              text not null,
  bank_branch            text not null,
  account_number         text not null,
  ifsc_code              text not null,

  declaration_accepted   boolean not null default false,
  -- [{slot, name, path, size, uploaded_at}] — path is a private storage
  -- object path, never a public URL. See get-empanelment-document-url.
  documents              jsonb not null default '[]',

  submitted_at           timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger ba_registrations_set_updated_at
before update on public.ba_registrations
for each row execute function public.set_updated_at();

-- Per-application activity timeline. Distinct from public.application_audit_log
-- (that one is account-management events, md/cfo/cs-only visibility) — this
-- one needs visibility for the assigned PO/DGM/AC on that specific
-- application too, a different RLS shape.
create table public.empanelment_activity_log (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.empanelment_applications(id) on delete cascade,
  actor_id        uuid references public.afc_users(id), -- null for BA-originated actions
  actor_role      text not null,                          -- afc_users role, or 'ba'
  action          text not null,
  comment         text,
  created_at      timestamptz not null default now()
);

create index empanelment_activity_log_application_idx on public.empanelment_activity_log(application_id);

-- Field-level compliance holds. One "raise hold" action can flag multiple
-- fields at once, sharing a hold_batch_id.
create table public.compliance_flags (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.empanelment_applications(id) on delete cascade,
  hold_batch_id   uuid not null default gen_random_uuid(),
  field_key       text not null,
  field_label     text not null,
  raised_by       uuid not null references public.afc_users(id),
  raised_by_role  text not null,
  comment         text not null,
  status          text not null default 'open' check (status in ('open','resolved')),
  old_value       text,
  new_value       text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index compliance_flags_application_idx on public.compliance_flags(application_id);
create index compliance_flags_status_idx      on public.compliance_flags(application_id, status);

-- ── Storage ─────────────────────────────────────────────────────
-- Private bucket. No storage.objects RLS policies for authenticated/anon —
-- every read/write goes through a service-role edge function, which
-- re-verifies authorization itself before uploading or signing a URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ba-documents', 'ba-documents', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- ── RLS ─────────────────────────────────────────────────────────
alter table public.empanelment_applications enable row level security;
alter table public.ba_registrations         enable row level security;
alter table public.empanelment_activity_log enable row level security;
alter table public.compliance_flags         enable row level security;

create or replace function public.can_view_empanelment_application(app_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empanelment_applications a
    where a.id = app_id
      and (
        public.current_afc_role() in ('md', 'cfo', 'cs')
        or (public.current_afc_role() = 'dgm' and a.team = public.current_afc_team())
        or (public.current_afc_role() = 'project_officer' and a.project_officer_id = auth.uid())
        or (public.current_afc_role() = 'associate_consultant' and a.sent_by = auth.uid())
      )
  );
$$;

create policy empanelment_applications_select on public.empanelment_applications
for select using (public.can_view_empanelment_application(id));

create policy ba_registrations_select on public.ba_registrations
for select using (public.can_view_empanelment_application(application_id));

create policy empanelment_activity_log_select on public.empanelment_activity_log
for select using (public.can_view_empanelment_application(application_id));

create policy compliance_flags_select on public.compliance_flags
for select using (public.can_view_empanelment_application(application_id));

-- ── Realtime ────────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.empanelment_applications,
  public.empanelment_activity_log,
  public.compliance_flags;
