// supabase/functions/request-empanelment-otp/index.ts
// JWT must be ON. Issues a one-time code emailed to the CALLER'S OWN
// registered address, gating md_accept / md_reject (advance-empanelment-stage)
// and provisional_letter (send-provisional-letter). Re-runs the same
// auth/state guard the real action uses so a stray OTP request can't probe
// applications the caller isn't actually allowed to act on.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { issueOtp } from "../_shared/otp.ts";

const OTP_ACTIONS = new Set(["md_accept", "md_reject", "provisional_letter"]);

// Same set send-provisional-letter allows — any stage once the BA has
// filled the form.
const PROVISIONAL_ALLOWED_STATUSES = new Set([
  "filled", "po_review", "cfo_cs_review", "po_final_review", "dgm_review", "md_review", "accepted", "on_hold",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const adminClient = createAdminClient();
  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const { application_id, action } = body;
  if (!application_id || typeof application_id !== "string") return jsonRes(req, 400, { error: "application_id is required." });
  if (!action || typeof action !== "string" || !OTP_ACTIONS.has(action)) return jsonRes(req, 400, { error: "Invalid action." });

  const { data: app, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, team, provisional_letter_sent")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  if (action === "md_accept" || action === "md_reject") {
    if (caller.role !== "md") return jsonRes(req, 403, { error: "Only the MD can act at this stage." });
    if (app.status !== "md_review") {
      return jsonRes(req, 400, { error: `This application is in "${app.status}" status, not "md_review". It may have just been updated by someone else — refresh and try again.` });
    }
  } else {
    // provisional_letter
    if (caller.role !== "dgm") return jsonRes(req, 403, { error: "Only a DGM can send the provisional empanelment letter." });
    if (caller.team !== app.team) return jsonRes(req, 403, { error: "Only the team's DGM can send the provisional letter for this application." });
    if (!PROVISIONAL_ALLOWED_STATUSES.has(app.status)) return jsonRes(req, 400, { error: "The BA hasn't submitted their form yet, so there's nothing to send a letter for." });
    if (app.provisional_letter_sent) return jsonRes(req, 400, { error: "A provisional letter has already been sent for this application." });
  }

  const result = await issueOtp(adminClient, {
    userId: caller.id,
    userEmail: caller.email,
    applicationId: application_id,
    action,
  });
  if (!result.ok) return jsonRes(req, 429, { error: result.error });

  return jsonRes(req, 200, { success: true, sent_to: caller.email });
});
