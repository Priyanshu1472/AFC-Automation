// supabase/functions/preview-empanelment-letter/index.ts
// JWT must be ON. Read-only: renders the exact same PDF the real action
// would attach/send, WITHOUT performing that action — no email, no status
// change, no ref-number/sent-flag persisted, no activity log entry. Lets
// the MD/DGM see precisely what they're about to sign before they type
// their PIN to actually confirm it (see advance-empanelment-stage's
// md_accept and send-provisional-letter for the real, PIN-gated actions —
// authorization here mirrors each of those exactly, minus the PIN check).
//
// Computing a ref number here is safe to do without persisting it: both
// buildEmpanelmentLetter and buildProvisionalLetter derive the ref from a
// read-only COUNT query, never a sequence/counter that this call would
// consume — so a preview never "burns" the number the real send will get
// (barring the ordinary race of two accepts happening between preview and
// confirm, same as any preview-then-commit UI).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile, isCallerOnTeam } from "../_shared/auth.ts";
import { bytesToBase64 } from "../_shared/letterPdf.ts";
import { buildEmpanelmentLetter } from "../_shared/empanelmentLetterPdf.ts";
import { buildProvisionalLetter } from "../_shared/provisionalLetterPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

// Same set send-provisional-letter allows sending from.
const PROVISIONAL_ALLOWED_STATUSES = new Set([
  "filled", "po_review", "cfo_cs_review", "po_final_review", "dgm_review", "md_review", "accepted", "on_hold",
]);

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

  const { application_id, type } = body as { application_id?: string; type?: string };
  if (!application_id || typeof application_id !== "string") return jsonRes(req, 400, { error: "application_id is required." });
  if (type !== "final" && type !== "provisional") return jsonRes(req, 400, { error: 'type must be "final" or "provisional".' });

  const { data: app, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, team, application_code, provisional_letter_sent")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  try {
    if (type === "final") {
      // Mirrors md_accept's authorization exactly, minus the PIN check.
      if (caller.role !== "md") return jsonRes(req, 403, { error: "Only the MD can preview this letter." });
      if (app.status !== "md_review") return jsonRes(req, 400, { error: `This application is in "${app.status}" status, not "md_review".` });

      const { data: baData } = await adminClient
        .from("ba_registrations")
        .select("org_name, contact_person, designation, reg_address, sectors_served")
        .eq("application_id", application_id)
        .maybeSingle();
      if (!baData) return jsonRes(req, 400, { error: "The BA hasn't submitted their form yet." });

      const built = await buildEmpanelmentLetter(adminClient, baData, caller.id);
      if (!built) return jsonRes(req, 500, { error: "Could not generate the letter preview. Please try again." });
      return jsonRes(req, 200, { success: true, pdf_base64: bytesToBase64(built.pdfBytes) });
    }

    // type === "provisional" — mirrors send-provisional-letter's authorization exactly, minus the PIN check.
    if (caller.role !== "dgm") return jsonRes(req, 403, { error: "Only a DGM can preview the provisional letter." });
    if (!isCallerOnTeam(caller, app.team)) return jsonRes(req, 403, { error: "Only the team's DGM can preview the provisional letter for this application." });
    if (!PROVISIONAL_ALLOWED_STATUSES.has(app.status)) return jsonRes(req, 400, { error: "The BA hasn't submitted their form yet, so there's nothing to preview." });
    if (app.provisional_letter_sent) return jsonRes(req, 400, { error: "A provisional letter has already been sent for this application." });

    const { data: reg } = await adminClient
      .from("ba_registrations")
      .select("org_name, contact_person, designation, reg_address")
      .eq("application_id", application_id)
      .maybeSingle();
    if (!reg) return jsonRes(req, 400, { error: "The BA hasn't submitted their form yet." });

    const built = await buildProvisionalLetter(adminClient, app, reg, caller.id);
    if (!built) return jsonRes(req, 500, { error: "Could not generate the letter preview. Please try again." });
    return jsonRes(req, 200, { success: true, pdf_base64: bytesToBase64(built.pdfBytes) });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

// AFC_EDGE_TEST is never set in any real deployment — only by the test
// command (see supabase/functions/deno.json). Wrapped rather than passed
// directly: `serve` invokes its handler with a second `connInfo` argument,
// which would otherwise land in `adminClient`'s slot.
if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
