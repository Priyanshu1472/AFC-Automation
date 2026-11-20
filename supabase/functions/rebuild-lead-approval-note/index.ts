// supabase/functions/rebuild-lead-approval-note/index.ts
// JWT must be ON. Admin / Super Admin only. Re-runs the Lead Approval Note
// PDF generation for one lead WITHOUT touching its workflow: no status
// change, no lead timeline entry, no notifications.
//
// Use case: someone approved before their signature was uploaded — the
// PDF is built at decision time and reads each signer's CURRENT
// afc_users.signature_path, so once the signature is uploaded, a rebuild
// picks it up. Rebuilds the draft "Lead Approval Note" whenever the lead
// has one, and the final "MD Approval Note" whenever MD has approved.
// Logged to application_audit_log (Audit Logs → Account Activity).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { moduleOffResponse } from "../_shared/modules.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { regenerateApprovalNote } from "../_shared/leadApprovalPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;
type Doc = { category?: string };

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  const moduleOff = await moduleOffResponse(req, "leads");
  if (moduleOff) return moduleOff;
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;
  // "admin" here also covers Super Admin (see getCallerProfile).
  if (caller.role !== "admin") return jsonRes(req, 403, { error: "Only Admin can rebuild an Approval Note." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }
  const leadId = body.lead_id;
  if (!leadId || typeof leadId !== "string") return jsonRes(req, 400, { error: "lead_id is required." });

  const { data: lead, error: leadErr } = await adminClient
    .from("leads")
    .select("id, lead_number, documents")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

  const docs = (lead.documents || []) as Doc[];
  const hasDraft = docs.some((d) => d.category === "approval_note");
  const { count: mdApprovals } = await adminClient
    .from("lead_activity_log")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .eq("action", "md_approve");
  const hasFinal = (mdApprovals || 0) > 0 || docs.some((d) => d.category === "final_approval_note");

  if (!hasDraft && !hasFinal) {
    return jsonRes(req, 400, { error: "This lead has no Approval Note yet — nothing to rebuild." });
  }

  // Sequential, not parallel: each run reads lead.documents and writes the
  // whole array back, so two at once would drop one of the two files.
  const rebuilt: string[] = [];
  if (hasDraft) {
    const result = await regenerateApprovalNote(adminClient, leadId, "draft");
    if (!result.ok) return jsonRes(req, 500, { error: `Lead Approval Note rebuild failed: ${result.error}` });
    rebuilt.push(result.document.name);
  }
  if (hasFinal) {
    const result = await regenerateApprovalNote(adminClient, leadId, "final");
    if (!result.ok) return jsonRes(req, 500, { error: `MD Approval Note rebuild failed: ${result.error}` });
    rebuilt.push(result.document.name);
  }

  await adminClient.from("application_audit_log").insert({
    action_by: caller.id,
    action_by_role: caller.actual_role || caller.role,
    action: "approval_note_rebuilt",
    comment: `Rebuilt ${rebuilt.join(" + ")} for lead ${lead.lead_number || leadId}`,
  });

  return jsonRes(req, 200, { success: true, rebuilt });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
