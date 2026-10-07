// supabase/functions/send-provisional-letter/index.ts
// JWT must be ON. The provisional empanelment letter (a non-final PDF emailed
// to the BP, distinct from the MD's final acceptance email — see the
// "Empanelment Letter" attached in advance-empanelment-stage's md_accept)
// needs the MD's approval before it goes out. Three actions:
//   - "request": the application's assigned advising authority (DGM / AGM /
//     GM in empanelment_applications.dgm_id) asks the MD to approve it.
//   - "approve": the MD approves with their action PIN — the letter is
//     generated, signed in the *advisor's* name, and emailed to the BP.
//   - "decline": the MD declines with a reason; the advisor may re-request.
// Requestable only once the PO has forwarded the application to the CS
// (isProvisionalLetterOpen). PDF layout ported from the previous AFC
// empanelment app's send-provisional-mail function; letterhead engine shared
// with the Empanelment Letter via _shared/letterPdf.ts.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile, isCallerOnTeam } from "../_shared/auth.ts";
import { sendResendEmail } from "../_shared/email.ts";
import { emailRole, notifyRole, notifyUser, notifyUsers } from "../_shared/notify.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { bytesToBase64 } from "../_shared/letterPdf.ts";
import { buildProvisionalLetter, isProvisionalLetterOpen } from "../_shared/provisionalLetterPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const ADVISOR_ROLES = ["dgm", "agm", "general_manager"];
function advisorLabel(role: string | null | undefined): string {
  return role === "agm" ? "AGM" : role === "general_manager" ? "General Manager" : "DGM";
}

function buildEmailBody(orgName: string, refNumber: string, validUntil: string): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;
                line-height:1.8;max-width:600px;margin:0 auto;padding:32px;">
      <p>Dear Sir / Ma'am,</p>
      <p>Greetings from <strong>AFC India Limited</strong>!</p>
      <p>We are pleased to inform you that the empanelment application submitted by
         <strong>${orgName}</strong> has been reviewed. Please find the
         <strong style="color:#0C6029;">Provisional Empanelment Letter</strong>
         attached to this email as a PDF document.</p>
      <div style="background:#f0faf4;border-left:4px solid #0C6029;border-radius:4px;
                  padding:18px 22px;margin:24px 0;">
        <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#0C6029;
                  text-transform:uppercase;letter-spacing:.06em;">Important Details</p>
        <table style="font-size:14px;border-collapse:collapse;width:100%;">
          <tr>
            <td style="padding:4px 0;color:#555;font-weight:600;width:180px;">Reference Number</td>
            <td style="padding:4px 0;color:#1a1a1a;font-weight:700;font-family:monospace;">${refNumber}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#555;font-weight:600;">Valid Until</td>
            <td style="padding:4px 0;color:#1a1a1a;font-weight:700;">${validUntil}</td>
          </tr>
        </table>
        <p style="margin:12px 0 0;font-size:12px;color:#005528;line-height:1.6;">
          This is a <strong>provisional</strong> empanelment — not a final empanelment.
          Please refer to the attached letter for the full terms and conditions.
        </p>
      </div>
      <p>For queries, write to us at
         <a href="mailto:afc@afcindia.org.in" style="color:#0C6029;">afc@afcindia.org.in</a>.</p>
      <br/>
      <p style="margin:0;">Kind Regards,</p>
      <p style="margin:4px 0 0;"><strong>AFC India Limited</strong></p>
      <p style="margin:2px 0 0;font-size:12px;color:#666;">afc@afcindia.org.in</p>
    </div>`;
}

async function logActivity(admin: AdminClient, applicationId: string, actorId: string, actorRole: string, action: string, comment: string | null) {
  await admin.from("empanelment_activity_log").insert({ application_id: applicationId, actor_id: actorId, actor_role: actorRole, action, comment });
}

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

  const { application_id, pin, action, note, reason } = body as { application_id?: string; pin?: unknown; action?: string; note?: unknown; reason?: unknown };
  if (!application_id || typeof application_id !== "string") return jsonRes(req, 400, { error: "application_id is required." });
  if (action !== "request" && action !== "approve" && action !== "decline") return jsonRes(req, 400, { error: "Unknown action. Please refresh the page and try again." });

  if (action === "request" && !ADVISOR_ROLES.includes(caller.role)) return jsonRes(req, 403, { error: "Only the advising DGM, AGM, or General Manager can request the provisional empanelment letter." });
  if (action !== "request" && caller.role !== "md") return jsonRes(req, 403, { error: "Only the Managing Director can approve or decline the provisional empanelment letter." });

  const { data: app, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, hold_origin_status, ba_email, team, sent_by, dgm_id, application_code, provisional_letter_sent, provisional_request_status, provisional_requested_by")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  if (action === "request" && (!isCallerOnTeam(caller, app.team) || caller.id !== app.dgm_id)) {
    return jsonRes(req, 403, { error: "Only the advising authority assigned to this application can request its provisional letter." });
  }
  if (app.status === "rejected") return jsonRes(req, 400, { error: "This application was found ineligible — a provisional letter can't be sent." });
  if (!isProvisionalLetterOpen(app.status, app.hold_origin_status)) return jsonRes(req, 400, { error: "The provisional letter can be requested only after the Project Officer has forwarded this application to the CS." });
  if (app.provisional_letter_sent) return jsonRes(req, 400, { error: "A provisional letter has already been sent for this application." });

  const { data: reg } = await adminClient
    .from("ba_registrations")
    .select("org_name, contact_person, designation, reg_address")
    .eq("application_id", application_id)
    .maybeSingle();
  if (!reg) return jsonRes(req, 400, { error: "The BP hasn't submitted their form yet." });
  const orgName = reg.org_name || "the Organization";

  // ── Advisor asks the MD ──────────────────────────────────────────────
  if (action === "request") {
    if (app.provisional_request_status === "pending") return jsonRes(req, 400, { error: "MD approval for the provisional letter has already been requested." });
    const noteText = typeof note === "string" && note.trim() ? note.trim().slice(0, 1000) : null;
    const { error: updErr } = await adminClient
      .from("empanelment_applications")
      .update({
        provisional_request_status: "pending",
        provisional_requested_by: caller.id,
        provisional_requested_at: new Date().toISOString(),
        provisional_request_note: noteText,
        provisional_decline_reason: null,
      })
      .eq("id", application_id)
      .eq("provisional_letter_sent", false);
    if (updErr) return jsonRes(req, 500, { error: "Database error. Please try again." });

    await logActivity(adminClient, application_id, caller.id, caller.role, "provisional_requested", noteText || `Requested MD approval to send the provisional letter to ${orgName}.`);
    await notifyRole(adminClient, "md", {
      title: "Provisional letter awaiting your approval",
      sub_text: `The ${advisorLabel(caller.role)} has requested approval to send ${orgName}'s provisional empanelment letter.`,
      type: "action_required",
      link: `/empanelment/${application_id}`,
    });
    await emailRole(adminClient, "md", {
      subject: `Approval needed: Provisional Empanelment Letter — ${orgName}`,
      html: `<p>Dear Sir / Ma'am,</p><p>The ${advisorLabel(caller.role)} has requested your approval to send the provisional empanelment letter to <strong>${orgName}</strong> (Application ${app.application_code || ""}).</p>${noteText ? `<p><em>Note: ${noteText}</em></p>` : ""}<p>Please log in to review the letter and approve or decline it.</p>`,
    });
    return jsonRes(req, 200, { success: true, requested: true });
  }

  // From here on the caller is the MD, acting on a pending request.
  if (app.provisional_request_status !== "pending") return jsonRes(req, 400, { error: "There is no pending provisional letter request for this application." });

  // ── MD declines ──────────────────────────────────────────────────────
  if (action === "decline") {
    const reasonText = typeof reason === "string" ? reason.trim().slice(0, 1000) : "";
    if (!reasonText) return jsonRes(req, 400, { error: "Please give a reason for declining." });
    const { error: updErr } = await adminClient
      .from("empanelment_applications")
      .update({ provisional_request_status: "declined", provisional_decline_reason: reasonText })
      .eq("id", application_id)
      .eq("provisional_request_status", "pending");
    if (updErr) return jsonRes(req, 500, { error: "Database error. Please try again." });

    await logActivity(adminClient, application_id, caller.id, caller.role, "provisional_declined", reasonText);
    await notifyUser(adminClient, app.provisional_requested_by || app.dgm_id, {
      title: "Provisional letter declined",
      sub_text: `The MD declined the provisional letter for ${orgName}: ${reasonText}`,
      type: "info",
      link: `/empanelment/${application_id}`,
    });
    return jsonRes(req, 200, { success: true, declined: true });
  }

  // ── MD approves → letter is generated and emailed ────────────────────
  const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, pin);
  if (pinErr) return jsonRes(req, 400, { error: pinErr });

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return jsonRes(req, 500, { error: "Email service not configured." });

  try {
    // Signed by the assigned advising authority, not the approving MD — every
    // empanelment letter carries the advisor's signature. Only a legacy
    // application with no dgm_id falls back to the MD.
    let built: Awaited<ReturnType<typeof buildProvisionalLetter>>;
    try {
      built = await buildProvisionalLetter(adminClient, app, reg, app.dgm_id || caller.id);
    } catch (pdfErr) {
      console.error("PDF generation error:", pdfErr);
      return jsonRes(req, 500, { error: "Failed to generate PDF. Please try again." });
    }
    if (!built) return jsonRes(req, 500, { error: "Could not load logo. Please try again." });
    const { pdfBytes, refNumber, validUntilStr } = built;

    const { error: updateErr } = await adminClient
      .from("empanelment_applications")
      .update({ provisional_letter_sent: true, provisional_sent_at: new Date().toISOString(), provisional_request_status: null, provisional_approved_by: caller.id })
      .eq("id", application_id)
      .eq("provisional_letter_sent", false);
    if (updateErr) return jsonRes(req, 500, { error: "Database error. Please try again." });

    const pdfFilename = `Provisional_Letter_${refNumber.replace(/\//g, "_")}.pdf`;
    const emailSent = await sendResendEmail({
      to: app.ba_email,
      subject: `Provisional Empanelment Letter — AFC India Limited (Ref: ${refNumber})`,
      html: buildEmailBody(orgName, refNumber, validUntilStr),
      attachments: [{ filename: pdfFilename, content: bytesToBase64(pdfBytes) }],
    });

    if (!emailSent) {
      await adminClient
        .from("empanelment_applications")
        .update({ provisional_letter_sent: false, provisional_sent_at: null, provisional_request_status: "pending", provisional_approved_by: null })
        .eq("id", application_id);
      return jsonRes(req, 500, { error: "Email delivery failed. Please try again." });
    }

    await logActivity(adminClient, application_id, caller.id, caller.role, "provisional_letter_sent", `MD approved; provisional letter sent to ${app.ba_email} (Ref: ${refNumber})`);
    await notifyUsers(adminClient, [app.sent_by, app.dgm_id, app.provisional_requested_by], {
      title: "Provisional letter sent",
      sub_text: `The MD approved ${orgName}'s provisional empanelment letter (Ref: ${refNumber}); it has been emailed to the BP.`,
      type: "info",
      link: `/empanelment/${application_id}`,
    });

    return jsonRes(req, 200, { success: true, ref: refNumber, valid_until: validUntilStr });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error. Please try again." });
  }
}

// AFC_EDGE_TEST is never set in any real deployment — only by the test
// command (see supabase/functions/deno.json). Wrapped rather than passed
// directly: `serve` invokes its handler with a second `connInfo` argument,
// which would otherwise land in `adminClient`'s slot.
if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
