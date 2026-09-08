// supabase/functions/send-provisional-letter/index.ts
// JWT must be ON. Only the application's assigned advising authority (the DGM
// or AGM in empanelment_applications.dgm_id) can send this — it's a
// non-final, provisional empanelment letter (PDF) emailed to the BA, distinct
// from the MD's final acceptance email (see the "Empanelment Letter" attached
// in advance-empanelment-stage's md_accept). Sendable at ANY stage once the
// BA has filled the form — not gated behind MD's recommendation. PDF layout
// ported from the previous AFC empanelment app's send-provisional-mail
// function, adapted to this schema (empanelment_applications/
// ba_registrations instead of empanelment_invitations). Letterhead engine
// shared with the Empanelment Letter via _shared/letterPdf.ts.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile, isCallerOnTeam } from "../_shared/auth.ts";
import { sendResendEmail } from "../_shared/email.ts";
import { notifyUser } from "../_shared/notify.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { bytesToBase64 } from "../_shared/letterPdf.ts";
import { buildProvisionalLetter } from "../_shared/provisionalLetterPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

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

// Any stage once the BA has filled the form — the DGM doesn't have to wait
// for their own review turn, let alone MD's recommendation.
const ALLOWED_STATUSES = new Set([
  "filled", "po_review", "cfo_cs_review", "po_final_review", "dgm_review", "md_review", "accepted", "on_hold",
]);

async function logActivity(admin: AdminClient, applicationId: string, actorId: string, actorRole: string, action: string, comment: string | null) {
  await admin.from("empanelment_activity_log").insert({ application_id: applicationId, actor_id: actorId, actor_role: actorRole, action, comment });
}

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  if (!["dgm", "agm"].includes(caller.role)) return jsonRes(req, 403, { error: "Only the advising DGM or AGM can send the provisional empanelment letter." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const { application_id, pin } = body as { application_id?: string; pin?: unknown };
  if (!application_id || typeof application_id !== "string") return jsonRes(req, 400, { error: "application_id is required." });

  const { data: app, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, ba_email, team, sent_by, dgm_id, application_code, provisional_letter_sent")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  if (!isCallerOnTeam(caller, app.team) || caller.id !== app.dgm_id) {
    return jsonRes(req, 403, { error: "Only the advising authority assigned to this application can send its provisional letter." });
  }
  if (!ALLOWED_STATUSES.has(app.status)) return jsonRes(req, 400, { error: `The BA hasn't submitted their form yet, so there's nothing to send a letter for.` });
  if (app.provisional_letter_sent) return jsonRes(req, 400, { error: "A provisional letter has already been sent for this application." });

  const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, pin);
  if (pinErr) return jsonRes(req, 400, { error: pinErr });

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return jsonRes(req, 500, { error: "Email service not configured." });

  try {
    const { data: reg } = await adminClient
      .from("ba_registrations")
      .select("org_name, contact_person, designation, reg_address")
      .eq("application_id", application_id)
      .maybeSingle();
    if (!reg) return jsonRes(req, 400, { error: "The BA hasn't submitted their form yet." });

    const orgName = reg.org_name || "the Organization";

    let built: Awaited<ReturnType<typeof buildProvisionalLetter>>;
    try {
      built = await buildProvisionalLetter(adminClient, app, reg, caller.id);
    } catch (pdfErr) {
      console.error("PDF generation error:", pdfErr);
      return jsonRes(req, 500, { error: "Failed to generate PDF. Please try again." });
    }
    if (!built) return jsonRes(req, 500, { error: "Could not load logo. Please try again." });
    const { pdfBytes, refNumber, validUntilStr } = built;

    const { error: updateErr } = await adminClient
      .from("empanelment_applications")
      .update({ provisional_letter_sent: true, provisional_sent_at: new Date().toISOString() })
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
      await adminClient.from("empanelment_applications").update({ provisional_letter_sent: false, provisional_sent_at: null }).eq("id", application_id);
      return jsonRes(req, 500, { error: "Email delivery failed. Please try again." });
    }

    await logActivity(adminClient, application_id, caller.id, caller.role, "provisional_letter_sent", `Provisional letter sent to ${app.ba_email} (Ref: ${refNumber})`);
    await notifyUser(adminClient, app.sent_by, {
      title: "Provisional letter sent",
      sub_text: `${orgName}'s provisional empanelment letter (Ref: ${refNumber}) was sent by the DGM.`,
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
