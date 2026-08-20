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
