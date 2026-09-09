// supabase/functions/preview-empanelment-letter/index.ts
// JWT must be ON. Renders an empanelment letter PDF as base64 — no email,
// no status change, no ref-number/sent-flag persisted, no activity log.
//
// Two modes, distinguished by whether the letter has already been issued:
//
//  1. Pre-issue PREVIEW — the MD/DGM sees exactly what they're about to sign
//     before typing their PIN (see LetterPreviewPinModal). Authorization
//     mirrors advance-empanelment-stage's md_accept / send-provisional-letter
//     exactly, minus the PIN check.
//
//  2. Post-issue VIEW — the letter was already sent; any staff member who
//     can view the application (same predicate as get-empanelment-document-url)
//     can re-open it from the Empanelment list. The persisted ref/expiry are
//     passed back into the builder so the reproduced PDF matches what was
//     emailed instead of drifting on a live COUNT / "today" date.
//
// Computing a ref number in preview mode is safe without persisting it: the
// builders derive the ref from a read-only COUNT, never a sequence this call
// would consume.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile, isCallerOnTeam } from "../_shared/auth.ts";
import { bytesToBase64, formatDateDDMMYYYY, formatDateLong } from "../_shared/letterPdf.ts";
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
    .select("id, status, team, project_officer_id, sent_by, dgm_id, application_code, provisional_letter_sent, provisional_sent_at, empanelment_ref, empanelment_expires_at, decided_at")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  // Whether the caller may view this application at all — mirrors
  // can_view_empanelment_application() / get-empanelment-document-url, since
  // auth.uid() is null for the service-role client used here.
  const canViewApplication =
    ["md", "cfo", "cs", "admin"].includes(caller.role) ||
    (["dgm", "agm"].includes(caller.role) && isCallerOnTeam(caller, app.team)) ||
    (["project_officer", "project_assistant"].includes(caller.role) && caller.id === app.project_officer_id) ||
    (["associate_consultant", "project_assistant"].includes(caller.role) && caller.id === app.sent_by);

  try {
    if (type === "final") {
      const issued = app.status === "accepted";

      if (issued) {
        if (!canViewApplication) return jsonRes(req, 403, { error: "You do not have access to this application." });
      } else {
        // Pre-issue preview — mirrors md_accept's authorization, minus the PIN.
        if (caller.role !== "md") return jsonRes(req, 403, { error: "Only the MD can preview this letter." });
        if (app.status !== "md_review") return jsonRes(req, 400, { error: `This application is in "${app.status}" status, not "md_review".` });
      }

      const { data: baData } = await adminClient
        .from("ba_registrations")
        .select("org_name, contact_person, designation, reg_address, sectors_served")
        .eq("application_id", application_id)
        .maybeSingle();
      if (!baData) return jsonRes(req, 400, { error: "The BP hasn't submitted their form yet." });

      // For an issued letter, sign it as the MD who actually accepted it (from
      // the activity log), falling back to any MD; for a preview it's the
      // previewing MD themselves.
      let signerId = caller.id;
      if (issued) {
        const { data: acceptLog } = await adminClient
          .from("empanelment_activity_log")
          .select("actor_id")
          .eq("application_id", application_id)
          .in("action", ["md_accepted", "md_accepted_email_failed"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        signerId = acceptLog?.actor_id || caller.id;
        if (!acceptLog?.actor_id) {
          const { data: anyMd } = await adminClient.from("afc_users").select("id").eq("role", "md").eq("is_active", true).limit(1).maybeSingle();
          if (anyMd?.id) signerId = anyMd.id;
        }
      }

      const built = await buildEmpanelmentLetter(
        adminClient,
        baData,
        signerId,
        issued
          ? {
              refOverride: app.empanelment_ref,
              dateOverride: app.decided_at ? formatDateDDMMYYYY(new Date(app.decided_at)) : null,
              validUntilOverride: app.empanelment_expires_at ? formatDateLong(new Date(app.empanelment_expires_at)) : null,
            }
          : undefined
      );
      if (!built) return jsonRes(req, 500, { error: "Could not generate the letter. Please try again." });
      return jsonRes(req, 200, { success: true, pdf_base64: bytesToBase64(built.pdfBytes) });
    }

    // type === "provisional"
    const issued = !!app.provisional_letter_sent;

    if (issued) {
      if (!canViewApplication) return jsonRes(req, 403, { error: "You do not have access to this application." });
    } else {
      // Pre-issue preview — mirrors send-provisional-letter's authorization, minus the PIN.
      if (!["dgm", "agm"].includes(caller.role)) return jsonRes(req, 403, { error: "Only the advising DGM or AGM can preview the provisional letter." });
      if (!isCallerOnTeam(caller, app.team) || caller.id !== app.dgm_id) return jsonRes(req, 403, { error: "Only the advising authority assigned to this application can preview its provisional letter." });
      if (!PROVISIONAL_ALLOWED_STATUSES.has(app.status)) return jsonRes(req, 400, { error: "The BP hasn't submitted their form yet, so there's nothing to preview." });
    }

    const { data: reg } = await adminClient
      .from("ba_registrations")
      .select("org_name, contact_person, designation, reg_address")
      .eq("application_id", application_id)
      .maybeSingle();
    if (!reg) return jsonRes(req, 400, { error: "The BP hasn't submitted their form yet." });

    const built = await buildProvisionalLetter(
      adminClient,
      app,
      reg,
      app.dgm_id || caller.id,
      issued && app.provisional_sent_at ? { dateOverride: formatDateDDMMYYYY(new Date(app.provisional_sent_at)) } : undefined
    );
    if (!built) return jsonRes(req, 500, { error: "Could not generate the letter. Please try again." });
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
