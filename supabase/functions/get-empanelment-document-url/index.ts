// supabase/functions/get-empanelment-document-url/index.ts
// JWT must be ON. Re-verifies the caller can view this specific application
// server-side (never trusts the client) before signing a short-lived URL for
// a document in the private ba-documents bucket.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

const BUCKET = "ba-documents";
const SIGNED_URL_TTL_SECONDS = 5 * 60;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const adminClient = createAdminClient();
  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const { application_id, path } = body;
  if (!application_id || typeof application_id !== "string" || !path || typeof path !== "string") {
    return jsonRes(req, 400, { error: "application_id and path are required." });
  }
  // Documents are stored under `${application_id}/...` — reject any path
  // that doesn't belong to the application the caller claims to be viewing.
  if (!path.startsWith(`${application_id}/`)) {
    return jsonRes(req, 400, { error: "Path does not belong to this application." });
  }

  // can_view_empanelment_application() reads auth.uid(), which is null for
  // the service-role client used here (no end-user JWT session) — so
  // authorization is re-derived manually below from the caller's own
  // afc_users role/team, the same predicate the RLS helper encodes.
  const { data: application, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, team, project_officer_id, sent_by")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !application) return jsonRes(req, 404, { error: "Application not found." });

  const caller = callerResult.caller;
  const authorized =
    ["md", "cfo", "cs", "admin"].includes(caller.role) ||
    (caller.role === "dgm" && caller.team === application.team) ||
    (caller.role === "project_officer" && caller.id === application.project_officer_id) ||
    (["associate_consultant", "project_assistant"].includes(caller.role) && caller.id === application.sent_by);

  if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this application." });

  const { data: signed, error: signErr } = await adminClient.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed) return jsonRes(req, 500, { error: "Failed to generate document link." });

  return jsonRes(req, 200, { url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
});
