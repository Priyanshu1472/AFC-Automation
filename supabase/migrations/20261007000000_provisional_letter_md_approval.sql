-- The provisional letter no longer goes out on the advising authority's say
-- alone: the advisor (DGM / AGM / GM) *requests* it, and it is only emailed
-- once the MD approves (PIN-gated) — see send-provisional-letter. The letter
-- itself is still issued and signed in the advisor's name.
--
-- provisional_request_status: null = never requested, 'pending' = waiting on
-- the MD, 'declined' = MD declined (the advisor may request again). Once the
-- MD approves, provisional_letter_sent flips to true and this goes back to
-- null.

alter table public.empanelment_applications
  add column if not exists provisional_request_status text
    check (provisional_request_status in ('pending', 'declined')),
  add column if not exists provisional_requested_by uuid
    references public.afc_users(id) on delete set null,
  add column if not exists provisional_requested_at timestamptz,
  add column if not exists provisional_request_note text,
  add column if not exists provisional_decline_reason text,
  add column if not exists provisional_approved_by uuid
    references public.afc_users(id) on delete set null;

create index if not exists empanelment_applications_provisional_pending_idx
  on public.empanelment_applications (provisional_request_status)
  where provisional_request_status = 'pending';
