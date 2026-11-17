// supabase/functions/update-lead-due-date/index.ts
// JWT must be ON. Every other field on a lead locks solid once it reaches
// md_approved — this is the one deliberate exception. Only the named
// Person Responsible may use it, and only to change submission_deadline;
// nothing else about the lead is touched here, unlike the full update-lead
// edit (which this status is never eligible for in the first place).
//
// leads.submission_deadline is the only copy of this date anywhere —
// Proposal Preparation always reads it straight off the lead via a live
// join (ProposalPreparationPage's own fetch, can_edit_proposal(), the
// proposal chat's close condition), so this single update is also "the
// date in the connected proposal" updating, with nothing else to sync.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const { lead_id, submission_deadline } = body;
  if (!lead_id || typeof lead_id !== "string") return jsonRes(req, 400, { error: "lead_id is required." });
  if (typeof submission_deadline !== "string" || !DATE_RE.test(submission_deadline) || Number.isNaN(new Date(submission_deadline).getTime())) {
    return jsonRes(req, 400, { error: "A valid due date is required." });
  }

  const { data: lead, error: leadErr } = await adminClient
    .from("leads")
    .select("id, lead_number, title, status, person_responsible_id, submission_deadline")
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

  if (lead.status !== "md_approved") {
    return jsonRes(req, 400, { error: "This is only for an already-approved lead — use the normal Edit for anything still in review." });
  }
  if (caller.id !== lead.person_responsible_id) {
    return jsonRes(req, 403, { error: "Only the Person Responsible can update the due date on an approved lead." });
  }

  const { error: updateErr } = await adminClient
    .from("leads")
    .update({ submission_deadline })
    .eq("id", lead_id)
    .eq("status", "md_approved");
  if (updateErr) {
    console.error("update-lead-due-date failed:", updateErr.message);
    return jsonRes(req, 500, { error: "Failed to update the due date. Try again." });
  }

  await logLeadActivity(
    adminClient, lead_id, caller.id, caller.role, "due_date_updated", "md_approved", "md_approved",
    `Updated the submission deadline (from ${lead.submission_deadline ?? "—"} to ${submission_deadline}) after MD approval.`
  );

  return jsonRes(req, 200, { success: true });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
