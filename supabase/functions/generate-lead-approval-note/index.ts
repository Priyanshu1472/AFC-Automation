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
import { regenerateApprovalNote, SCRUTINY_PARAMETERS } from "../_shared/leadApprovalPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

function sanitizeScopeOfWork(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .slice(0, 20)
    .map((v) => v.trim().slice(0, 300));
}

// Parameters themselves are fixed (SCRUTINY_PARAMETERS) — only Yes/No and
// remarks come from the client, and lenient like every other field here:
// an invalid/missing entry just falls back to a safe default rather than
// hard-failing the whole submission.
function sanitizeScrutiny(input: unknown): { yes_no: "Yes" | "No"; remarks: string }[] {
  const arr = Array.isArray(input) ? input : [];
  return SCRUTINY_PARAMETERS.map((param, i) => {
    const entry = (arr[i] && typeof arr[i] === "object" ? arr[i] : {}) as Record<string, unknown>;
    const yesNo = entry.yes_no === "No" ? "No" : "Yes";
    const remarks = clampText(entry.remarks, 500) || param.defaultRemark;
    return { yes_no: yesNo, remarks };
  });
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
    .select("id, status, created_by, person_responsible_id, approval_note_pending_pr_review")
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
  // A creator-drafted note sitting with the PR for Accept/Edit/Reject can't
  // be edited out from under them by the creator — the PR either Accepts,
  // Edits it themselves (which calls pr_review_accept first, clearing this
  // flag, before ever reaching this endpoint), or Rejects it, at which
  // point this flag clears and the creator can edit again.
  if (lead.approval_note_pending_pr_review && caller.id !== lead.person_responsible_id) {
    return jsonRes(req, 400, { error: "This note is awaiting the Person Responsible's review — wait for their Accept/Edit/Reject." });
  }

  const financialInput = (body.financial_requirement && typeof body.financial_requirement === "object" ? body.financial_requirement : {}) as Record<string, unknown>;
  const approvalNoteData = {
    nature_of_lead: clampText(body.nature_of_lead, 200),
    client_address: clampText(body.client_address, 500),
    objectives: clampText(body.objectives, 3000),
    scope_of_work: sanitizeScopeOfWork(body.scope_of_work),
    project_timeline: clampText(body.project_timeline, 100),
    financial_requirement: {
      document_fee: clampText(financialInput.document_fee, 150),
      pbg: clampText(financialInput.pbg, 150),
      emd: clampText(financialInput.emd, 100),
      processing_fee: clampText(financialInput.processing_fee, 100),
    },
    revenue_sharing: clampText(body.revenue_sharing, 300),
    scrutiny: sanitizeScrutiny(body.scrutiny),
    justification: clampText(body.justification, 3000),
  };

  try {
    // Only counts as "PR-reviewed" (and therefore eligible for the PR's
    // signature on the PDF) when the PR is the one actually generating it —
    // the creator filling this in is always a draft awaiting PR review, see
    // regenerateApprovalNoteInner in leadApprovalPdf.ts.
    const isPersonResponsible = caller.id === lead.person_responsible_id;
    const { error: updateErr } = await adminClient
      .from("leads")
      .update({ approval_note_data: approvalNoteData, approval_note_pr_reviewed: isPersonResponsible })
      .eq("id", leadId);
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
