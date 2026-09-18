// supabase/functions/_shared/leadAuth.ts
// Lead Generation authorization is keyed directly off the existing
// afc_users.role/team (the universal role, already assigned on the Users
// page) plus a new afc_users.committee column (now just PMT — G3 and PMT
// Extended were removed from the approval chain, see
// 20260928000000_lead_committee_and_status_simplification.sql) — no
// separate role-assignment table. PMT is org-wide (spans every team, not
// one team apiece) — membership alone grants review/approval permission at
// that stage, regardless of the lead's team or the member's own team.

import { createAdminClient } from "./auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export type Committee = "PMT";

// The tier eligible to be Person Responsible for a lead (owns its
// PA_REVIEW accept/drop step) and to claim a dropped one. SRM has the same
// access/permissions as AGM throughout Lead Generation, per product
// decision — kept alongside it everywhere AGM appears in this module.
export const PA_TIER_ROLES = ["project_assistant", "project_officer", "area_manager", "regional_manager", "associate_consultant", "agm", "srm"];

export type TargetUser = { id: string; role: string; team: string | null; committee: string | null; is_active: boolean };

// Single-row lookup for a user referenced by id (e.g. a chosen Person
// Responsible/Reviewer/Recommending Authority) — distinct from the caller's
// own row, which getCallerProfile() already supplies.
export async function getTargetUser(admin: AdminClient, userId: string): Promise<TargetUser | null> {
  const { data, error } = await admin.from("afc_users").select("id, role, team, committee, is_active").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return data as TargetUser;
}

// Org-wide role or committee holders — PMT and 'md' are both org-wide, so
// this is the only lookup notify fan-out needs.
export async function getOrgWideHolders(admin: AdminClient, opts: { role?: string; committee?: Committee }): Promise<string[]> {
  let query = admin.from("afc_users").select("id").eq("is_active", true);
  if (opts.role) query = query.eq("role", opts.role);
  if (opts.committee) query = query.eq("committee", opts.committee);
  const { data, error } = await query;
  if (error) {
    console.error("getOrgWideHolders lookup failed:", error.message);
    return [];
  }
  return (data || []).map((u: { id: string }) => u.id);
}

// Bulk-adds the given users to a lead's chat roster (lead_chat_participants)
// — upsert with ignoreDuplicates so re-syncing an already-present member
// (e.g. re-running the PMT roster on a resubmission) is a no-op rather than
// an error. Called from advance-lead-stage whenever a lead enters a
// committee stage; every current member of that committee is added at
// once, not just whoever eventually acts.
export async function addLeadChatParticipants(admin: AdminClient, leadId: string, userIds: string[], roleAtAdd: string): Promise<void> {
  const rows = [...new Set(userIds)].filter(Boolean).map((user_id) => ({ lead_id: leadId, user_id, role_at_add: roleAtAdd }));
  if (!rows.length) return;
  const { error } = await admin.from("lead_chat_participants").upsert(rows, { onConflict: "lead_id,user_id", ignoreDuplicates: true });
  if (error) console.error("addLeadChatParticipants failed:", error.message);
}

// Team-scoped PA-tier role holders — used to notify a team when a lead is
// dropped and becomes available to claim.
export async function getPaTierHolders(admin: AdminClient, team: string): Promise<string[]> {
  const { data, error } = await admin.from("afc_users").select("id").in("role", PA_TIER_ROLES).eq("team", team).eq("is_active", true);
  if (error) {
    console.error("getPaTierHolders lookup failed:", error.message);
    return [];
  }
  return (data || []).map((u: { id: string }) => u.id);
}

type ViewerCaller = { id: string; role: string; team: string | null; teams?: string[]; committee: string | null };
type ViewableLead = {
  status: string;
  team: string;
  created_by: string;
  person_responsible_id: string | null;
  reviewer_id: string;
  recommending_authority_id: string;
  handled_by_dgm_id: string | null;
  assigned_ba_id: string | null;
};

// JS mirror of the DB's can_view_lead() — needed anywhere a service-role
// client (which bypasses RLS) has to re-derive the same visibility rule,
// e.g. signing a document URL. Keep this in lockstep with can_view_lead()
// in the migrations — the two drifting apart is exactly the kind of gap
// that let get-lead-document-url stay on the old team-wide rule after
// can_view_lead() itself had already been narrowed.
//   - md/admin/cfo/cs/dgm/agm/srm/general_manager: every lead, org-wide
//     (see 20260928000200_lead_org_wide_visibility.sql).
//   - PMT committee membership: org-wide, every lead.
//   - Always: Person Responsible/Reviewer/Recommending Authority/handling
//     DGM, or the assigned Business Partner.
//   - The creator, but only while still on the lead's current team — once
//     a lead transfers away, the old creator loses it (see
//     20261001020000_lead_creator_visibility_after_transfer.sql).
//   - project_officer/area_manager/regional_manager/associate_consultant/
//     project_assistant: every lead on their own team, at any status — not
//     just while it's unclaimed (person_responsible_id null); otherwise a
//     PO loses access to a lead on their own team the moment they assign
//     it away via po_assign (see 20261001030000_lead_pa_tier_team_wide_
//     visibility.sql).
const PA_TIER_TEAM_WIDE_ROLES = ["project_officer", "area_manager", "regional_manager", "associate_consultant", "project_assistant"];

export function canViewLead(caller: ViewerCaller, lead: ViewableLead): boolean {
  if (["md", "admin", "cfo", "cs", "dgm", "general_manager", "agm", "srm"].includes(caller.role)) return true;
  if (caller.committee === "PMT") return true;
  if ([lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id, lead.handled_by_dgm_id].includes(caller.id)) return true;
  const callerTeams = caller.teams ?? (caller.team ? [caller.team] : []);
  if (caller.id === lead.created_by && callerTeams.includes(lead.team)) return true;
  if (PA_TIER_TEAM_WIDE_ROLES.includes(caller.role) && callerTeams.includes(lead.team)) return true;
  if (caller.role === "business_associate" && lead.assigned_ba_id === caller.id) return true;
  return false;
}
