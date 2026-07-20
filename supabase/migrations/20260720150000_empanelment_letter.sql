-- Final Empanelment Letter (distinct from the provisional one) is sent
-- alongside BA portal credentials when the MD accepts. Ref number and
-- validity are recorded so the letter is never regenerated with a
-- different reference number for the same acceptance.
alter table public.empanelment_applications
  add column empanelment_ref text,
  add column empanelment_expires_at timestamptz;
