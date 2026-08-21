// supabase/functions/_shared/leadAuth.ts
// Lead Generation authorization is keyed directly off the existing
// afc_users.role/team (the universal role, already assigned on the Users
// page) plus a new afc_users.committee column (PMT / PMT Extended / G3) —
// no separate role-assignment table. All three committees are org-wide
// (they each span all 4 teams, not one team apiece) — membership alone
// grants review/approval permission at that stage, regardless of the
// lead's team or the member's own team.

import { createAdminClient } from "./auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export type Committee = "PMT" | "PMT Extended" | "G3";

// The tier eligible to be Person Responsible for a lead (owns its
// PA_REVIEW accept/drop step) and to claim a dropped one. SRM has the same
// access/permissions as AGM throughout Lead Generation, per product
// decision — kept alongside it everywhere AGM appears in this module.
export const PA_TIER_ROLES = ["project_assistant", "project_officer", "associate_consultant", "agm", "srm"];

export type TargetUser = { id: string; role: string; team: string | null; committee: string | null; is_active: boolean };

// Single-row lookup for a user referenced by id (e.g. a chosen Person
// Responsible/Reviewer/Approval Authority) — distinct from the caller's own
// row, which getCallerProfile() already supplies.
export async function getTargetUser(admin: AdminClient, userId: string): Promise<TargetUser | null> {
  const { data, error } = await admin.from("afc_users").select("id, role, team, committee, is_active").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return data as TargetUser;
}

// Org-wide role or committee holders — every committee (PMT/PMT Extended/
// G3) and 'md' are all org-wide, so this is the only lookup notify fan-out
// needs.
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

type ViewerCaller = { id: string; role: string; team: string | null; committee: string | null };
type ViewableLead = {
  status: string;
  team: string;
  created_by: string;
  person_responsible_id: string;
  reviewer_id: string;
  approval_authority_id: string;
  handled_by_dgm_id: string | null;
  assigned_ba_id: string | null;
};

// JS mirror of the DB's can_view_lead() — needed anywhere a service-role
// client (which bypasses RLS) has to re-derive the same visibility rule,
// e.g. signing a document URL. Keep this in lockstep with can_view_lead()
// in the migrations — the two drifting apart is exactly the kind of gap
// that let get-lead-document-url stay on the old team-wide rule after
// can_view_lead() itself had already been narrowed.
//   - md/admin/cfo/cs: every lead, org-wide.
//   - dgm: every lead on their own team.
//   - project_assistant/project_officer/associate_consultant: every lead
//     on their own team.
//   - agm/srm: only leads they're actually named on.
//   - PMT/PMT Extended/G3 committee membership: org-wide, only while the
//     lead is at the stage that committee reviews.
//   - Always: creator/Person Responsible/Reviewer/Approval Authority/
//     handling DGM, or the assigned Business Associate.
export function canViewLead(caller: ViewerCaller, lead: ViewableLead): boolean {
  if (["md", "admin", "cfo", "cs"].includes(caller.role)) return true;
  if (caller.role === "dgm" && caller.team === lead.team) return true;
  if (["project_assistant", "project_officer", "associate_consultant"].includes(caller.role) && caller.team === lead.team) return true;
  if (["dgm_initial_review", "dgm_review"].includes(lead.status) && caller.committee === "G3") return true;
  if (lead.status === "pmt_review" && caller.committee === "PMT") return true;
  if (lead.status === "pmt_extended_review" && caller.committee === "PMT Extended") return true;
  if ([lead.created_by, lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id, lead.handled_by_dgm_id].includes(caller.id)) return true;
  if (caller.role === "business_associate" && lead.assigned_ba_id === caller.id) return true;
  return false;
}
