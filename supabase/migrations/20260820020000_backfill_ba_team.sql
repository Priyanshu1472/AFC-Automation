-- provisionBaAccount (advance-empanelment-stage) now sets afc_users.team
-- from the originating empanelment application's team when a BA portal
-- login is first created, so each team's BAs are scoped correctly in the
-- Lead Generation form's Business Associate dropdown going forward. This
-- backfills every BA account that was already provisioned before that
-- change (team is currently null) from their own application history —
-- most recent application per BA wins if they somehow have more than one.
update public.afc_users u
set team = app.team
from (
  select distinct on (ba_user_id) ba_user_id, team
  from public.empanelment_applications
  where ba_user_id is not null
  order by ba_user_id, created_at desc
) app
where u.id = app.ba_user_id
  and u.role = 'business_associate'
  and u.team is null;
