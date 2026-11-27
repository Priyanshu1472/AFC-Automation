// supabase/functions/delete-empanelment-application/index.ts
// JWT must be ON. Caller must be the one who sent this particular invite
// (sent_by), and the application must still be at "sent" (the BP hasn't
// filled the form yet) — once there's a real submission and review history,
// it's no longer deletable here, only actionable through the normal pipeline.
// Deleting the empanelment_applications row cascades to ba_registrations,
// empanelment_activity_log, compliance_flags and empanelment_action_otps
// (all FKs are `on delete cascade` — see 20260717160000_empanelment_schema.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { moduleOffResponse } from "../_shared/modules.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  const moduleOff = await moduleOffResponse(req, "empanelment");
  if (moduleOff) return moduleOff;
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

  const { application_id } = body as { application_id?: string };
  if (!application_id || typeof application_id !== "string") return jsonRes(req, 400, { error: "application_id is required." });

  const { data: app, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, sent_by")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  if (app.sent_by !== caller.id) return jsonRes(req, 403, { error: "Only the person who sent this invitation can delete it." });
  if (app.status !== "sent") return jsonRes(req, 400, { error: "This can only be deleted while the BP hasn't filled the form yet." });

  try {
    const { error: delErr } = await adminClient.from("empanelment_applications").delete().eq("id", application_id);
    if (delErr) throw new Error("Failed to delete application: " + delErr.message);
    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

// AFC_EDGE_TEST is never set in any real deployment — only by the test
// command (see supabase/functions/deno.json). Wrapped rather than passed
// directly: `serve` invokes its handler with a second `connInfo` argument,
// which would otherwise land in `adminClient`'s slot.
if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
