// supabase/functions/_shared/leadEligibility.ts
// Server-side field/assignment validation for create-lead and update-lead —
// mirrors the shape the parent spec calls LeadEligibilityService, kept as
// plain functions rather than a class since there's no shared instance
// state. Never trust the client's role/team/committee claims: every
// assignment target is re-validated against afc_users here.
//
// Person Responsible / Reviewer / Approval Authority are informational
// contacts on the lead, not the actual workflow gate — the real
// PMT/PMT Extended/G3 authorization is committee membership, checked
// separately in advance-lead-stage (and org-wide, not team-scoped, since
// committees span all 4 teams). So these just confirm the target is an
// active member of the right team (and, for Approval Authority, AGM/SRM/DGM).

import { createAdminClient } from "./auth.ts";
import { getTargetUser } from "./leadAuth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export type LeadFieldInput = {
  title?: unknown;
  lead_type?: unknown;
  source?: unknown;
  delivery_type?: unknown;
  person_responsible_id?: unknown;
  reviewer_id?: unknown;
  approval_authority_id?: unknown;
};

const DELIVERY_TYPES = new Set(["online", "offline", "both"]);
const MAX_TITLE_LENGTH = 500;
const MAX_TEXT_LENGTH = 2000;

export function validateRequiredFields(input: LeadFieldInput): string | null {
  if (typeof input.title !== "string" || !input.title.trim()) return "Name of Assignment is required.";
  if (input.title.trim().length > MAX_TITLE_LENGTH) return "Name of Assignment is too long.";
  if (typeof input.person_responsible_id !== "string" || !input.person_responsible_id) return "Person Responsible is required.";
  if (typeof input.reviewer_id !== "string" || !input.reviewer_id) return "Reviewer is required.";
  if (typeof input.approval_authority_id !== "string" || !input.approval_authority_id) return "Approval Authority is required.";
  if (input.delivery_type != null && !DELIVERY_TYPES.has(String(input.delivery_type))) return "Invalid delivery type.";
  // Only RFP / In-House is active in this phase — reject anything else
  // outright rather than silently coercing, so a stale/tampered client
  // can't slip a lead into an unimplemented path.
  if (input.lead_type != null && input.lead_type !== "rfp") return "Only RFP leads can be created at this time.";
  if (input.source != null && input.source !== "in_house") return "Only In-House leads can be created at this time.";
  return null;
}

export function clampText(val: unknown, max = MAX_TEXT_LENGTH): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

// Person Responsible must be an active user on the lead's team — any role.
export async function validateAssignment(admin: AdminClient, personResponsibleId: string, team: string): Promise<string | null> {
  const user = await getTargetUser(admin, personResponsibleId);
  if (!user || !user.is_active || user.team !== team) {
    return "Person Responsible must be an active user on this team.";
  }
  return null;
}

// Reviewer must be an active user on the lead's team — any role.
export async function validateReviewer(admin: AdminClient, reviewerId: string, team: string): Promise<string | null> {
  const user = await getTargetUser(admin, reviewerId);
  if (!user || !user.is_active || user.team !== team) {
    return "Reviewer must be an active user on this team.";
  }
  return null;
}

// Approval Authority must be an active AGM, SRM (same permissions as AGM
// throughout Lead Generation), or DGM on the lead's team.
export async function validateApprovalAuthority(admin: AdminClient, approvalAuthorityId: string, team: string): Promise<string | null> {
  const user = await getTargetUser(admin, approvalAuthorityId);
  if (!user || !user.is_active || user.team !== team || !["agm", "srm", "dgm"].includes(user.role)) {
    return "Approval Authority must be an active AGM, SRM, or DGM on this team.";
  }
  return null;
}

// Each team empanels its own Business Associates (via the Empanelment
// module) — a BA's afc_users.team is set from the empanelment application's
// team when their portal login is provisioned, so this mirrors the other
// assignment validators: active + same team as the lead.
export async function validateBusinessAssociate(admin: AdminClient, baId: string, team: string): Promise<string | null> {
  const { data, error } = await admin.from("afc_users").select("id, role, team, is_active").eq("id", baId).maybeSingle();
  if (error || !data) return "Selected Business Associate not found.";
  if (data.role !== "business_associate" || !data.is_active || data.team !== team) {
    return "Selected Business Associate is not valid for this team.";
  }
  return null;
}
