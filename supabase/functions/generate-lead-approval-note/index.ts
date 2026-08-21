// supabase/functions/generate-lead-approval-note/index.ts
// JWT must be ON. Replaces the old one-click "Accept" at pa_review: the
// creator or Person Responsible fills the Lead Approval Form here, which
// upserts leads.approval_note_data and (re)generates the draft "Lead
// Approval Note" PDF via the shared engine — status never changes here.
// The actual pa_review -> dgm_initial_review transition still happens
// through advance-lead-stage's existing "accept" action, which now
// requires this note to exist first. Available again at pa_action_required
// (after a decline) so the note can be edited and regenerated before
// resubmitting — mirrors update-lead's own status whitelist.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
import { clampText } from "../_shared/leadEligibility.ts";
import { regenerateApprovalNote } from "../_shared/leadApprovalPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

function sanitizeScopeOfWork(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .slice(0, 20)
    .map((v) => v.trim().slice(0, 300));
}

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
  if (!leadId) return jsonRes(req, 400, { error: "lead_id is required." });

  const { data: lead, error: leadErr } = await adminClient
    .from("leads")
    .select("id, status, created_by, person_responsible_id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

  if (caller.id !== lead.created_by && caller.id !== lead.person_responsible_id) {
    return jsonRes(req, 403, { error: "Only the lead's creator or Person Responsible can generate its Approval Note." });
  }
  if (lead.status !== "pa_review" && lead.status !== "pa_action_required") {
    return jsonRes(req, 400, {
      error: `This lead is in "${lead.status}" status — the Approval Note can only be generated/edited before it's submitted for DGM approval, or while it's been returned for changes.`,
    });
  }

  const financialInput = (body.financial_requirement && typeof body.financial_requirement === "object" ? body.financial_requirement : {}) as Record<string, unknown>;
  const approvalNoteData = {
    nature_of_lead: clampText(body.nature_of_lead, 200),
    client_address: clampText(body.client_address, 500),
    objectives: clampText(body.objectives, 3000),
    scope_of_work: sanitizeScopeOfWork(body.scope_of_work),
    project_timeline: clampText(body.project_timeline, 100),
    financial_requirement: {
      document_fee_emd_pbg: clampText(financialInput.document_fee_emd_pbg, 300),
      emd: clampText(financialInput.emd, 100),
      processing_fee: clampText(financialInput.processing_fee, 100),
    },
    revenue_sharing: clampText(body.revenue_sharing, 300),
  };

  try {
    const { error: updateErr } = await adminClient.from("leads").update({ approval_note_data: approvalNoteData }).eq("id", leadId);
    if (updateErr) return jsonRes(req, 500, { error: "Failed to save the Approval Note fields." });

    const result = await regenerateApprovalNote(adminClient, leadId, "draft");
    if (!result.ok) return jsonRes(req, 500, { error: result.error });

    await logLeadActivity(adminClient, leadId, caller.id, caller.role, "approval_note_generated", lead.status, lead.status, null);

    return jsonRes(req, 200, { success: true, document: result.document });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
