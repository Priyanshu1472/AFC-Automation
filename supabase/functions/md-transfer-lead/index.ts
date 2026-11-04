// supabase/functions/md-transfer-lead/index.ts
// JWT must be ON. MD's own, standalone "Transfer Lead" action, available
// directly on any lead's detail page, org-wide, with no Cross-Team Query
// needed first (respond-lead-query's "transfer"/"approve_transfer" actions
// remain the query-triggered path; this is the free-standing one). Reuses
// the exact same engine (_shared/leadTransfer.ts's performLeadTransfer) so
// the result is identical either way: new team, new lead number, reset to
// po_assignment/Awaiting Assignment under the chosen person, old roster
// cleared, and the old team no longer sees it in their own lists.

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

  if (caller.role !== "md") return jsonRes(req, 403, { error: "Only the MD can transfer a lead." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
  if (!leadId) return jsonRes(req, 400, { error: "lead_id is required." });
  const targetTeam = typeof body.target_team === "string" ? body.target_team : "";
  if (!targetTeam) return jsonRes(req, 400, { error: "Select a team to transfer to." });
  const forwardedToId = typeof body.forwarded_to_id === "string" ? body.forwarded_to_id : "";
  if (!forwardedToId) return jsonRes(req, 400, { error: "Select who to forward the lead to." });
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
  if (!comment) return jsonRes(req, 400, { error: "Remarks are required to transfer a lead." });

  try {
    const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
    if (pinErr) return jsonRes(req, 400, { error: pinErr });

    const result = await performLeadTransfer(adminClient, leadId, targetTeam, forwardedToId, comment, caller.id);
    if (!result.ok) return jsonRes(req, 400, { error: result.error });

    return jsonRes(req, 200, { success: true, lead_number: result.leadNumber });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
