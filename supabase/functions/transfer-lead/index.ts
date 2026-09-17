// supabase/functions/transfer-lead/index.ts
// JWT must be ON. PMT-committee-only, and only while the lead is at its
// pmt_review stage (the "Transfer Lead to Another Team" button on the lead
// detail page) — moves the lead to a different team and resets it to a
// fresh pa_review for that team to pick up (see _shared/leadTransfer.ts for
// exactly what gets cleared/kept). respond-lead-query's own "transfer"
// action — PMT resolving a cross-team lead query, which can legitimately
// happen at any status — is a separate entry point that shares
// performLeadTransfer() but not this function's committee/status gate.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { performLeadTransfer } from "../_shared/leadTransfer.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  // This standalone "Transfer Lead" button/action is PMT-committee-only —
  // not even md/admin — and only while the lead is actually at its
  // pmt_review stage. This is deliberately narrower than
  // respond-lead-query's own "transfer" action (a different, separate
  // workflow — PMT resolving a cross-team lead query, which can legitimately
  // happen at any status) — don't add this restriction to the shared
  // performLeadTransfer(), only here.
  if (caller.committee !== "PMT") {
    return jsonRes(req, 403, { error: "Only a PMT committee member can transfer a lead." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
  const targetTeam = typeof body.target_team === "string" ? body.target_team.trim() : "";
  const justification = typeof body.justification === "string" ? body.justification.trim().slice(0, 2000) : "";
  if (!leadId) return jsonRes(req, 400, { error: "lead_id is required." });
  if (!targetTeam) return jsonRes(req, 400, { error: "target_team is required." });
  if (!justification) return jsonRes(req, 400, { error: "A justification is required." });

  const { data: leadStatusRow, error: leadStatusErr } = await adminClient
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .maybeSingle();
  if (leadStatusErr || !leadStatusRow) return jsonRes(req, 404, { error: "Lead not found." });
  if (leadStatusRow.status !== "pmt_review") {
    return jsonRes(req, 403, { error: "A lead can only be transferred to another team while it's at the PMT review stage." });
  }

  const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
  if (pinErr) return jsonRes(req, 400, { error: pinErr });

  try {
    const result = await performLeadTransfer(adminClient, leadId, targetTeam, justification, caller.id);
    if (!result.ok) return jsonRes(req, 400, { error: result.error });
    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
