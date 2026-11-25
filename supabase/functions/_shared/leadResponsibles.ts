// supabase/functions/_shared/leadResponsibles.ts
// Lead-side mirror of _shared/proposalAuth.ts's checkCanEditProposal() —
// backs add-lead-responsible/remove-lead-responsible, and the
// isPr()-widening done across update-lead, advance-lead-stage,
// update-lead-due-date and generate-lead-approval-note (every place that
// used to treat "caller.id === lead.person_responsible_id" as the sole
// definition of "is this the Person Responsible").

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

// Dead ends — nothing is left for an additional responsible to help with
// once a lead lands here. Mirrors can_manage_lead_responsibles() in
// 20261125010000_lead_additional_responsibles.sql.
const CLOSED_STATUSES = new Set(["pa_dropped", "md_declined"]);

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

  if (CLOSED_STATUSES.has(lead.status as string)) {
    return { ok: false, status: 400, error: "This lead has already been dropped or declined." };
  }

  const isNamed =
    ["md", "admin"].includes(caller.role) ||
    [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(caller.id);

  if (!isNamed) {
    const { data: already } = await admin
      .from("lead_additional_responsibles")
      .select("id")
      .eq("lead_id", leadId)
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!already) return { ok: false, status: 403, error: "You don't have permission to manage this lead's team." };
  }

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
