// supabase/functions/_shared/leadResponsibles.ts
// Lead-side mirror of _shared/proposalAuth.ts's checkCanEditProposal() —
// backs add-lead-responsible/remove-lead-responsible, and the
// isPr()-widening done across update-lead, advance-lead-stage,
// update-lead-due-date and generate-lead-approval-note (every place that
// used to treat "caller.id === lead.person_responsible_id" as the sole
// definition of "is this the Person Responsible").
//
// Managing the list itself (checkCanManageLeadResponsibles, below) is
// deliberately narrower than that: an additional responsible gets every
// other Person-Responsible action, but not this one — only the lead's
// named PR/Reviewer/Recommending Authority or MD/Admin may add or remove
// someone from the list.

import { createAdminClient } from "./auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

type Lead = {
  id: string;
  lead_number: string;
  title: string;
  status: string;
  team: string | null;
  person_responsible_id: string | null;
  reviewer_id: string | null;
  recommending_authority_id: string | null;
};

export type LeadManageCheck =
  | { ok: true; lead: Lead }
  | { ok: false; status: number; error: string };

// Managing the list is only meaningful while the lead is still with the
// PR — pa_review (first pass) or pa_action_required (sent back for
// rework by the Recommending Authority, PMT, or MD). Once it clears
// Recommending Authority review the roster is considered locked in; a
// later decline that returns it to pa_action_required re-opens the
// window again. Mirrors can_manage_lead_responsibles() in
// 20261126000000_lead_responsibles_pr_stage_only.sql.
const MANAGEABLE_STATUSES = new Set(["pa_review", "pa_action_required"]);

export async function checkCanManageLeadResponsibles(
  admin: AdminClient,
  leadId: string,
  caller: { id: string; role: string }
): Promise<LeadManageCheck> {
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, lead_number, title, status, team, person_responsible_id, reviewer_id, recommending_authority_id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, status: 404, error: "Lead not found." };

  if (!MANAGEABLE_STATUSES.has(lead.status as string)) {
    return { ok: false, status: 400, error: "This is only available while the lead is still with the Person Responsible, before Recommending Authority review." };
  }

  // Named only — md/admin or the lead's own PR/Reviewer/Recommending
  // Authority. An additional responsible gets every other action a named
  // Person Responsible has, but not this one: they can't add (or remove)
  // another additional responsible themselves.
  const isNamed =
    ["md", "admin"].includes(caller.role) ||
    [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(caller.id);
  if (!isNamed) return { ok: false, status: 403, error: "You don't have permission to manage this lead's team." };

  return { ok: true, lead: lead as Lead };
}

export async function getLeadAdditionalResponsibleIds(admin: AdminClient, leadId: string): Promise<string[]> {
  const { data } = await admin.from("lead_additional_responsibles").select("user_id").eq("lead_id", leadId);
  return (data || []).map((r: { user_id: string }) => r.user_id);
}

export async function isLeadAdditionalResponsible(admin: AdminClient, leadId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("lead_additional_responsibles")
    .select("id")
    .eq("lead_id", leadId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
