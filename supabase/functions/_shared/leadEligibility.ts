// supabase/functions/_shared/leadEligibility.ts
// Server-side field/assignment validation for create-lead and update-lead —
// mirrors the shape the parent spec calls LeadEligibilityService, kept as
// plain functions rather than a class since there's no shared instance
// state. Never trust the client's role/team/committee claims: every
// assignment target is re-validated against afc_users here.
//
// Person Responsible / Reviewer are informational contacts on the lead;
// Recommending Authority is the actual first-line workflow gate (see
// advance-lead-stage's recommending_authority_review case — only this
// exact named person, not just any AGM/DGM, can act there). PMT
// authorization is separately committee membership (org-wide, since PMT
// spans every team), checked in advance-lead-stage. These functions just
// confirm each target is an active member of the right team (and, for
// Recommending Authority, AGM/SRM/DGM).

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
  recommending_authority_id?: unknown;
};

const DELIVERY_TYPES = new Set(["online", "offline", "both"]);
const MAX_TITLE_LENGTH = 500;
const MAX_TEXT_LENGTH = 2000;

// requireAssignment=false skips the Person Responsible/Reviewer/
// Recommending Authority checks — used when an Associate Consultant/Project
// Assistant creates a lead: they aren't allowed to name those three
// themselves, so the lead is created with all three null and routed to the
// team's Project Officer instead (see create-lead's isPoRouted branch and
// advance-lead-stage's "po_assign" action, which re-applies these same
// checks once the PO actually fills them in).
export function validateRequiredFields(input: LeadFieldInput, opts: { requireAssignment?: boolean } = {}): string | null {
  const requireAssignment = opts.requireAssignment !== false;
  if (typeof input.title !== "string" || !input.title.trim()) return "Name of Assignment is required.";
  if (input.title.trim().length > MAX_TITLE_LENGTH) return "Name of Assignment is too long.";
  if (requireAssignment) {
    if (typeof input.person_responsible_id !== "string" || !input.person_responsible_id) return "Person Responsible is required.";
    if (typeof input.reviewer_id !== "string" || !input.reviewer_id) return "Reviewer is required.";
    if (typeof input.recommending_authority_id !== "string" || !input.recommending_authority_id) return "Recommending Authority is required.";
  }
  if (input.delivery_type != null && !DELIVERY_TYPES.has(String(input.delivery_type))) return "Invalid delivery type.";
  // lead_type (RFP/EOI) doesn't apply to a Suo Moto lead — the frontend just
  // sends a fixed placeholder value for it in that case, so this stays
  // rfp/eoi only. source now covers all three: In-House, BP Source, and
  // Suo Moto.
  if (input.lead_type != null && !["rfp", "eoi"].includes(String(input.lead_type))) return "Invalid lead type.";
  if (input.source != null && !["in_house", "ba", "suo_moto"].includes(String(input.source))) return "Invalid lead source.";
  return null;
}

export function clampText(val: unknown, max = MAX_TEXT_LENGTH): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

// Person Responsible must be an active staff member on the lead's team,
// excluding Business Partners (have a team too, for the BP-org lookup, but
// aren't staff and can't own a lead's workflow) and the AGM/SRM/DGM/General
// Manager tier — they're the Recommending Authority/oversight roles, not
// hands-on PR work.
const PERSON_RESPONSIBLE_EXCLUDED_ROLES = ["business_associate", "agm", "srm", "dgm", "general_manager"];

export async function validateAssignment(admin: AdminClient, personResponsibleId: string, team: string): Promise<string | null> {
  const user = await getTargetUser(admin, personResponsibleId);
  if (!user || !user.is_active || user.team !== team || PERSON_RESPONSIBLE_EXCLUDED_ROLES.includes(user.role as string)) {
    return "Person Responsible must be an active staff member on this team (not a Business Partner or AGM/SRM/DGM/General Manager).";
  }
  return null;
}

// Reviewer must be an active staff member on the lead's team — any role
// except business_associate, same reasoning as Person Responsible above.
export async function validateReviewer(admin: AdminClient, reviewerId: string, team: string): Promise<string | null> {
  const user = await getTargetUser(admin, reviewerId);
  if (!user || !user.is_active || user.team !== team || user.role === "business_associate") {
    return "Reviewer must be an active staff member on this team.";
  }
  return null;
}

// Recommending Authority must be an active AGM, SRM (same permissions as
// AGM throughout Lead Generation), or DGM on the lead's team — and is the
// exact person gated on at the recommending_authority_review stage, not
// just any team member with one of those roles.
export async function validateRecommendingAuthority(admin: AdminClient, recommendingAuthorityId: string, team: string): Promise<string | null> {
  const user = await getTargetUser(admin, recommendingAuthorityId);
  if (!user || !user.is_active || user.team !== team || !["agm", "srm", "dgm", "general_manager"].includes(user.role)) {
    return "Recommending Authority must be an active AGM, SRM, DGM, or General Manager on this team.";
  }
  return null;
}

// "Forward to:" target (create-lead's isPoRouted branch, and PMT transfer)
// — unlike Person Responsible/Reviewer/Recommending Authority, any team
// member can be forwarded a lead regardless of role, so this only checks
// active + team membership. Checked against afc_user_teams (not just the
// afc_users.team scalar), so a multi-team secondary member is a valid
// target too.
export async function validateForwardedTo(admin: AdminClient, userId: string, team: string): Promise<string | null> {
  const { data: user, error: userErr } = await admin.from("afc_users").select("id, is_active").eq("id", userId).maybeSingle();
  if (userErr || !user || !user.is_active) return "Selected person not found.";
  const { data: membership, error: teamErr } = await admin
    .from("afc_user_teams")
    .select("user_id")
    .eq("user_id", userId)
    .eq("team", team)
    .maybeSingle();
  if (teamErr || !membership) return "Selected person is not a member of that team.";
  return null;
}

// Any active, empanelled Business Partner can be linked to a lead — from
// any team, not just the lead's own (a BP's afc_users.team is just the team
// that empanelled them). Mirrors get_empanelled_business_partners(). `_team`
// is kept so callers don't need to change.
export async function validateBusinessAssociate(admin: AdminClient, baId: string, _team?: string): Promise<string | null> {
  const { data, error } = await admin.from("afc_users").select("id, role, is_active").eq("id", baId).maybeSingle();
  if (error || !data) return "Selected Business Partner not found.";
  if (data.role !== "business_associate" || !data.is_active) {
    return "Selected Business Partner is not an active, empanelled Business Partner.";
  }
  return null;
}

// A Business Partner that isn't on PMIS (empanelled before PMIS existed) —
// either one already in manual_business_partners (manualBaId) or a name
// typed on the lead form (manualBaName). A typed name reuses the existing
// row with the same name (case-insensitive) rather than adding a duplicate.
export async function resolveManualBusinessPartner(
  admin: AdminClient,
  opts: { manualBaId?: string | null; manualBaName?: string | null; team?: string | null; createdBy: string },
): Promise<{ id: string | null; error?: string }> {
  if (opts.manualBaId) {
    const { data } = await admin.from("manual_business_partners").select("id").eq("id", opts.manualBaId).maybeSingle();
    if (!data) return { id: null, error: "Selected Business Partner not found." };
    return { id: data.id as string };
  }
  const name = (opts.manualBaName || "").replace(/\s+/g, " ").trim();
  if (!name) return { id: null };
  if (name.length < 2 || name.length > 300) return { id: null, error: "Business Partner name must be 2–300 characters." };

  const findExisting = async () => {
    const { data } = await admin.from("manual_business_partners").select("id, org_name").ilike("org_name", name.replace(/[\\%_]/g, "\\$&"));
    return ((data || []) as Array<{ id: string; org_name: string }>).find((r) => r.org_name.trim().toLowerCase() === name.toLowerCase()) || null;
  };
  const existing = await findExisting();
  if (existing) return { id: existing.id };

  const { data: inserted, error } = await admin
    .from("manual_business_partners")
    .insert({ org_name: name, team: opts.team || null, created_by: opts.createdBy })
    .select("id")
    .single();
  if (inserted) return { id: inserted.id as string };
  // Lost a race with someone adding the same name at the same moment.
  const raced = await findExisting();
  if (raced) return { id: raced.id };
  console.error("Manual BP insert failed:", error?.message);
  return { id: null, error: "Could not save the Business Partner name. Please try again." };
}
