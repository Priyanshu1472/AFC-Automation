// supabase/functions/create-proposal-preparation/index.ts
// JWT must be ON. Idempotent create/fetch of the proposal_preparations row
// for an approved lead — "Open Proposal" calls this on first visit. Caller
// must be the lead's Person Responsible, Reviewer, or Approval Authority
// (the authorised signatory needs to reach the page too, to lock/decide
// outcome later), or md/admin. Mirrors create-lead's shape.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
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

  const leadId = body.lead_id;
  if (typeof leadId !== "string" || !leadId) return jsonRes(req, 400, { error: "lead_id is required." });

  try {
    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, status, person_responsible_id, reviewer_id, approval_authority_id")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    const authorized =
      ["md", "admin"].includes(caller.role) ||
      [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this lead's proposal." });

    if (lead.status !== "md_approved") {
      return jsonRes(req, 400, { error: "This lead has not been approved for proposal preparation yet." });
    }

    const { data: existing } = await adminClient
      .from("proposal_preparations")
      .select("id")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (existing) return jsonRes(req, 200, { success: true, proposal_id: existing.id });

    const { data: created, error: insertErr } = await adminClient
      .from("proposal_preparations")
      .insert({ lead_id: leadId, created_by: caller.id })
      .select("id")
      .single();
    if (insertErr) throw new Error(insertErr.message);

    return jsonRes(req, 200, { success: true, proposal_id: created.id });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
