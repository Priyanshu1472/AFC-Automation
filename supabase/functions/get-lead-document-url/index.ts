// supabase/functions/get-lead-document-url/index.ts
// JWT must be ON. Near-identical to get-empanelment-document-url: re-derives
// the caller's access to this specific lead server-side (the service-role
// client bypasses RLS/auth.uid(), so can_view_lead() can't be relied on
// here) before signing a short-lived URL for a document in the private
// lead-documents bucket.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const BUCKET = "lead-documents";
const SIGNED_URL_TTL_SECONDS = 5 * 60;

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

  const { lead_id, path } = body;
  if (!lead_id || typeof lead_id !== "string" || !path || typeof path !== "string") {
    return jsonRes(req, 400, { error: "lead_id and path are required." });
  }
  // Documents are stored under `${lead_id}/...` — reject any path that
  // doesn't belong to the lead the caller claims to be viewing.
  if (!path.startsWith(`${lead_id}/`)) {
    return jsonRes(req, 400, { error: "Path does not belong to this lead." });
  }

  const { data: lead, error: leadErr } = await adminClient
    .from("leads")
    .select("id, status, team, created_by, person_responsible_id, reviewer_id, approval_authority_id, handled_by_dgm_id, assigned_ba_id")
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

  const authorized =
    ["md", "admin"].includes(caller.role) ||
    caller.team === lead.team ||
    (["dgm_initial_review", "dgm_review"].includes(lead.status) && caller.committee === "G3") ||
    [lead.created_by, lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id, lead.handled_by_dgm_id].includes(caller.id) ||
    (caller.role === "business_associate" && lead.assigned_ba_id === caller.id);

  if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this lead." });

  const { data: signed, error: signErr } = await adminClient.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed) return jsonRes(req, 500, { error: "Failed to generate document link." });

  return jsonRes(req, 200, { url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
