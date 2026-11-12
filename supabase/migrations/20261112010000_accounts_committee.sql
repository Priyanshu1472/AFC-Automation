-- Adds "Accounts" as an assignable afc_users.committee value, the same way
-- G3 was added alongside PMT — purely a selectable tag at this point, no
-- permissions, visibility rule, or workflow anywhere treats committee =
-- 'Accounts' as special. Those come later, once there's an actual Accounts
-- workflow to gate; this migration only makes the value legal to set.
alter table public.afc_users drop constraint afc_users_committee_check;
alter table public.afc_users add constraint afc_users_committee_check
  check (committee is null or committee in ('PMT', 'G3', 'Accounts'));
