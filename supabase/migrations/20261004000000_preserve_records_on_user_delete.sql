-- Deleting a user (delete-staff-user) used to fail outright the moment the
-- account had ANY history, because every table below referenced afc_users
-- (or auth.users directly) with the default ON DELETE NO ACTION — including
-- application_audit_log.action_by, which every admin action writes, making
-- admin accounts with any activity permanently undeletable.
--
-- Product decision: deleting a user should remove only that user's own
-- login + profile — every record they touched (leads, proposals, fee
-- notes, chat messages, audit log entries, etc.) stays exactly as it was,
-- just with the now-gone person's reference nulled out instead of blocking
-- the delete. A handful of pure membership/OTP rows (a chat participant
-- slot, a committee seat, a one-time-code row) have no meaning without the
-- user, so those cascade-delete instead of leaving an orphaned row with a
-- null identity.

-- ── Attribution columns: keep the row, null the reference ──────────────

alter table public.application_audit_log alter column action_by drop not null;
alter table public.application_audit_log drop constraint application_audit_log_action_by_fkey;
alter table public.application_audit_log add constraint application_audit_log_action_by_fkey
  foreign key (action_by) references auth.users(id) on delete set null;
alter table public.application_audit_log drop constraint application_audit_log_action_by_afc_users_fkey;
alter table public.application_audit_log add constraint application_audit_log_action_by_afc_users_fkey
  foreign key (action_by) references public.afc_users(id) on delete set null;

alter table public.afc_users drop constraint afc_users_created_by_fkey;
alter table public.afc_users add constraint afc_users_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.afc_users drop constraint afc_users_managed_by_dgm_fkey;
alter table public.afc_users add constraint afc_users_managed_by_dgm_fkey
  foreign key (managed_by_dgm) references auth.users(id) on delete set null;

alter table public.committees alter column created_by drop not null;
alter table public.committees drop constraint committees_created_by_fkey;
alter table public.committees add constraint committees_created_by_fkey
  foreign key (created_by) references public.afc_users(id) on delete set null;

alter table public.company_documents alter column uploaded_by drop not null;
alter table public.company_documents drop constraint company_documents_uploaded_by_fkey;
alter table public.company_documents add constraint company_documents_uploaded_by_fkey
  foreign key (uploaded_by) references public.afc_users(id) on delete set null;

alter table public.compliance_flags alter column raised_by drop not null;
alter table public.compliance_flags drop constraint compliance_flags_raised_by_fkey;
alter table public.compliance_flags add constraint compliance_flags_raised_by_fkey
  foreign key (raised_by) references public.afc_users(id) on delete set null;

alter table public.empanelment_activity_log alter column actor_id drop not null;
alter table public.empanelment_activity_log drop constraint empanelment_activity_log_actor_id_fkey;
alter table public.empanelment_activity_log add constraint empanelment_activity_log_actor_id_fkey
  foreign key (actor_id) references public.afc_users(id) on delete set null;

alter table public.empanelment_applications alter column ba_user_id drop not null;
alter table public.empanelment_applications drop constraint empanelment_applications_ba_user_id_fkey;
alter table public.empanelment_applications add constraint empanelment_applications_ba_user_id_fkey
  foreign key (ba_user_id) references public.afc_users(id) on delete set null;

alter table public.empanelment_applications alter column dgm_id drop not null;
alter table public.empanelment_applications drop constraint empanelment_applications_dgm_id_fkey;
alter table public.empanelment_applications add constraint empanelment_applications_dgm_id_fkey
  foreign key (dgm_id) references public.afc_users(id) on delete set null;

alter table public.empanelment_applications alter column project_officer_id drop not null;
alter table public.empanelment_applications drop constraint empanelment_applications_project_officer_id_fkey;
alter table public.empanelment_applications add constraint empanelment_applications_project_officer_id_fkey
  foreign key (project_officer_id) references public.afc_users(id) on delete set null;

alter table public.empanelment_applications alter column sent_by drop not null;
alter table public.empanelment_applications drop constraint empanelment_applications_sent_by_fkey;
alter table public.empanelment_applications add constraint empanelment_applications_sent_by_fkey
  foreign key (sent_by) references public.afc_users(id) on delete set null;

alter table public.fee_note_events alter column actor_id drop not null;
alter table public.fee_note_events drop constraint fee_note_events_actor_id_fkey;
alter table public.fee_note_events add constraint fee_note_events_actor_id_fkey
  foreign key (actor_id) references public.afc_users(id) on delete set null;

alter table public.fee_notes alter column created_by drop not null;
alter table public.fee_notes drop constraint fee_notes_created_by_fkey;
alter table public.fee_notes add constraint fee_notes_created_by_fkey
  foreign key (created_by) references public.afc_users(id) on delete set null;

alter table public.fee_notes drop constraint fee_notes_md_decided_by_fkey;
alter table public.fee_notes add constraint fee_notes_md_decided_by_fkey
  foreign key (md_decided_by) references public.afc_users(id) on delete set null;

alter table public.fee_notes drop constraint fee_notes_pr_signed_by_fkey;
alter table public.fee_notes add constraint fee_notes_pr_signed_by_fkey
  foreign key (pr_signed_by) references public.afc_users(id) on delete set null;

alter table public.fee_notes drop constraint fee_notes_aa_signed_by_fkey;
alter table public.fee_notes add constraint fee_notes_aa_signed_by_fkey
  foreign key (ra_signed_by) references public.afc_users(id) on delete set null;

alter table public.lead_activity_log alter column actor_id drop not null;
alter table public.lead_activity_log drop constraint lead_activity_log_actor_id_fkey;
alter table public.lead_activity_log add constraint lead_activity_log_actor_id_fkey
  foreign key (actor_id) references public.afc_users(id) on delete set null;

alter table public.lead_assignment_requests alter column previous_user_id drop not null;
alter table public.lead_assignment_requests drop constraint lead_assignment_requests_previous_user_id_fkey;
alter table public.lead_assignment_requests add constraint lead_assignment_requests_previous_user_id_fkey
  foreign key (previous_user_id) references public.afc_users(id) on delete set null;

alter table public.lead_assignment_requests alter column requested_by drop not null;
alter table public.lead_assignment_requests drop constraint lead_assignment_requests_requested_by_fkey;
alter table public.lead_assignment_requests add constraint lead_assignment_requests_requested_by_fkey
  foreign key (requested_by) references public.afc_users(id) on delete set null;

alter table public.lead_assignment_requests alter column requested_to drop not null;
alter table public.lead_assignment_requests drop constraint lead_assignment_requests_requested_to_fkey;
alter table public.lead_assignment_requests add constraint lead_assignment_requests_requested_to_fkey
  foreign key (requested_to) references public.afc_users(id) on delete set null;

alter table public.lead_chat_messages alter column sender_id drop not null;
alter table public.lead_chat_messages drop constraint lead_chat_messages_sender_id_fkey;
alter table public.lead_chat_messages add constraint lead_chat_messages_sender_id_fkey
  foreign key (sender_id) references public.afc_users(id) on delete set null;

alter table public.lead_conversion_events alter column actor_id drop not null;
alter table public.lead_conversion_events drop constraint lead_conversion_events_actor_id_fkey;
alter table public.lead_conversion_events add constraint lead_conversion_events_actor_id_fkey
  foreign key (actor_id) references public.afc_users(id) on delete set null;

alter table public.lead_conversions alter column claimed_by drop not null;
alter table public.lead_conversions drop constraint lead_conversions_claimed_by_fkey;
alter table public.lead_conversions add constraint lead_conversions_claimed_by_fkey
  foreign key (claimed_by) references public.afc_users(id) on delete set null;

alter table public.lead_conversions alter column created_by drop not null;
alter table public.lead_conversions drop constraint lead_conversions_created_by_fkey;
alter table public.lead_conversions add constraint lead_conversions_created_by_fkey
  foreign key (created_by) references public.afc_users(id) on delete set null;

alter table public.lead_conversions drop constraint lead_conversions_md_decided_by_fkey;
alter table public.lead_conversions add constraint lead_conversions_md_decided_by_fkey
  foreign key (md_decided_by) references public.afc_users(id) on delete set null;

alter table public.lead_queries alter column raised_by_id drop not null;
alter table public.lead_queries drop constraint lead_queries_raised_by_id_fkey;
alter table public.lead_queries add constraint lead_queries_raised_by_id_fkey
  foreign key (raised_by_id) references public.afc_users(id) on delete set null;

alter table public.lead_queries drop constraint lead_queries_resolved_by_id_fkey;
alter table public.lead_queries add constraint lead_queries_resolved_by_id_fkey
  foreign key (resolved_by_id) references public.afc_users(id) on delete set null;

alter table public.leads drop constraint leads_assigned_ba_id_fkey;
alter table public.leads add constraint leads_assigned_ba_id_fkey
  foreign key (assigned_ba_id) references public.afc_users(id) on delete set null;

alter table public.leads alter column created_by drop not null;
alter table public.leads drop constraint leads_created_by_fkey;
alter table public.leads add constraint leads_created_by_fkey
  foreign key (created_by) references public.afc_users(id) on delete set null;

alter table public.leads drop constraint leads_forwarded_to_id_fkey;
alter table public.leads add constraint leads_forwarded_to_id_fkey
  foreign key (forwarded_to_id) references public.afc_users(id) on delete set null;

alter table public.leads drop constraint leads_handled_by_dgm_id_fkey;
alter table public.leads add constraint leads_handled_by_dgm_id_fkey
  foreign key (handled_by_dgm_id) references public.afc_users(id) on delete set null;

alter table public.leads drop constraint leads_person_responsible_id_fkey;
alter table public.leads add constraint leads_person_responsible_id_fkey
  foreign key (person_responsible_id) references public.afc_users(id) on delete set null;

alter table public.leads drop constraint leads_approval_authority_id_fkey;
alter table public.leads add constraint leads_approval_authority_id_fkey
  foreign key (recommending_authority_id) references public.afc_users(id) on delete set null;

alter table public.leads drop constraint leads_reviewer_id_fkey;
alter table public.leads add constraint leads_reviewer_id_fkey
  foreign key (reviewer_id) references public.afc_users(id) on delete set null;

alter table public.project_documents alter column uploaded_by drop not null;
alter table public.project_documents drop constraint project_documents_uploaded_by_fkey;
alter table public.project_documents add constraint project_documents_uploaded_by_fkey
  foreign key (uploaded_by) references public.afc_users(id) on delete set null;

alter table public.projects drop constraint projects_created_by_fkey;
alter table public.projects add constraint projects_created_by_fkey
  foreign key (created_by) references public.afc_users(id) on delete set null;

alter table public.proposal_afc_checklist_items drop constraint proposal_afc_checklist_items_created_by_fkey;
alter table public.proposal_afc_checklist_items add constraint proposal_afc_checklist_items_created_by_fkey
  foreign key (created_by) references public.afc_users(id) on delete set null;

alter table public.proposal_afc_checklist_items drop constraint proposal_afc_checklist_items_uploaded_by_fkey;
alter table public.proposal_afc_checklist_items add constraint proposal_afc_checklist_items_uploaded_by_fkey
  foreign key (uploaded_by) references public.afc_users(id) on delete set null;

alter table public.proposal_chat_messages alter column sender_id drop not null;
alter table public.proposal_chat_messages drop constraint proposal_chat_messages_sender_id_fkey;
alter table public.proposal_chat_messages add constraint proposal_chat_messages_sender_id_fkey
  foreign key (sender_id) references public.afc_users(id) on delete set null;

alter table public.proposal_document_requests alter column created_by drop not null;
alter table public.proposal_document_requests drop constraint proposal_document_requests_created_by_fkey;
alter table public.proposal_document_requests add constraint proposal_document_requests_created_by_fkey
  foreign key (created_by) references public.afc_users(id) on delete set null;

alter table public.proposal_document_requests drop constraint proposal_document_requests_uploaded_by_fkey;
alter table public.proposal_document_requests add constraint proposal_document_requests_uploaded_by_fkey
  foreign key (uploaded_by) references public.afc_users(id) on delete set null;

alter table public.proposal_preparations drop constraint proposal_preparations_client_response_by_fkey;
alter table public.proposal_preparations add constraint proposal_preparations_client_response_by_fkey
  foreign key (client_response_by) references public.afc_users(id) on delete set null;

alter table public.proposal_preparations alter column created_by drop not null;
alter table public.proposal_preparations drop constraint proposal_preparations_created_by_fkey;
alter table public.proposal_preparations add constraint proposal_preparations_created_by_fkey
  foreign key (created_by) references public.afc_users(id) on delete set null;

alter table public.proposal_preparations drop constraint proposal_preparations_locked_by_fkey;
alter table public.proposal_preparations add constraint proposal_preparations_locked_by_fkey
  foreign key (locked_by) references public.afc_users(id) on delete set null;

alter table public.shortlists alter column created_by drop not null;
alter table public.shortlists drop constraint shortlists_created_by_fkey;
alter table public.shortlists add constraint shortlists_created_by_fkey
  foreign key (created_by) references public.afc_users(id) on delete set null;

-- ── Pure membership/OTP rows: no meaning without the user, so cascade ──

alter table public.committee_members drop constraint committee_members_user_id_fkey;
alter table public.committee_members add constraint committee_members_user_id_fkey
  foreign key (user_id) references public.afc_users(id) on delete cascade;

alter table public.lead_chat_participants drop constraint lead_chat_participants_user_id_fkey;
alter table public.lead_chat_participants add constraint lead_chat_participants_user_id_fkey
  foreign key (user_id) references public.afc_users(id) on delete cascade;

alter table public.proposal_chat_participants drop constraint proposal_chat_participants_user_id_fkey;
alter table public.proposal_chat_participants add constraint proposal_chat_participants_user_id_fkey
  foreign key (user_id) references public.afc_users(id) on delete cascade;

alter table public.empanelment_action_otps drop constraint empanelment_action_otps_user_id_fkey;
alter table public.empanelment_action_otps add constraint empanelment_action_otps_user_id_fkey
  foreign key (user_id) references public.afc_users(id) on delete cascade;

alter table public.lead_conversion_otps drop constraint lead_conversion_otps_user_id_fkey;
alter table public.lead_conversion_otps add constraint lead_conversion_otps_user_id_fkey
  foreign key (user_id) references public.afc_users(id) on delete cascade;
