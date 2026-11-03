-- PMT can now flag a conflicting lead at ANY in-progress stage, not just
-- another pmt_review lead — the earlier restriction to pmt_review-only
-- conflicts (20261102000000) made a convenient simplification possible
-- (every accepted lead was guaranteed already past Recommending Authority,
-- so it could always resume straight at md_review), but the org wants the
-- full org-wide lead list available to flag as conflicting, regardless of
-- stage. Each member lead's status at the moment it joined the escalation
-- is now recorded, so resolve-g3-escalation can decide per-lead whether
-- the accepted one goes straight to md_review (it had already cleared
-- Recommending Authority) or resumes exactly where it was (it hadn't).

alter table public.lead_g3_escalation_members add column previous_status text;
