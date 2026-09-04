// supabase/functions/send-provisional-letter/index.ts
// JWT must be ON. Only the assigned team's DGM can send this — it's a
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
import { verifyOtp } from "../_shared/otp.ts";
import {
  bytesToBase64, formatDateDDMMYYYY, formatDateLong, addMonths, BLACK,
  Segment, plain, bold, PageEngine, sd, sdLine, sdPara, sdGap, newPdfDoc,
} from "../_shared/letterPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

async function generateProvisionalPDF(opts: {
  logoBytes: Uint8Array;
  refNumber: string;
  date: string;
  contactPerson: string;
  designation: string;
  orgName: string;
  regAddress: string;
  applicationCode: string;
  signatoryName: string;
  signatoryDesignation: string;
  validUntil: string;
  validityMonths: number;
}): Promise<Uint8Array> {
  const { pdf, fonts } = await newPdfDoc();
  const e = new PageEngine(pdf, fonts, opts.logoBytes);
  const S = 9.5;
  const NI = 18;

  await e.newPage();

  await sdLine(e, opts.signatoryName, S, true);
  await sdLine(e, opts.signatoryDesignation, S, true);
  await sdGap(e, 20);

  e.drawTextAt(opts.refNumber, e.LEFT, S, true);
  e.drawTextRight(opts.date, S, true);
  e.gap(e.LINE_H);
  await sdGap(e, 20);

  await sdLine(e, "To,", S, false);
  await sdLine(e, opts.contactPerson, S, false);
  await sdLine(e, opts.designation, S, false);
  await sdLine(e, opts.orgName, S, false);

  const addrParts = opts.regAddress
    .split(/[,\n]/)
    .map((l: string) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const part of addrParts) {
    await sdLine(e, part.length > 72 ? part.slice(0, 72) : part, S, false);
  }

  await sdGap(e, 14);

  await sdPara(e, [
    bold("Sub: "),
    plain("Provisional Empanelment as Business Associate — AFC India Limited"),
  ], S);
  await sdGap(e, 3);
  await sd(e, () => e.drawRule());
  await sdGap(e, 8);

  await sdLine(e, `Dear ${opts.contactPerson},`, S, false);
  await sdGap(e, 8);

  await sdPara(e, [
    plain("We are pleased to inform you that the empanelment application submitted by "),
    bold(opts.orgName),
    plain(" bearing Application Code "),
    bold(opts.applicationCode),
    plain(" has been reviewed and evaluated by AFC India Limited. Based on the preliminary assessment of your organization's capabilities and credentials, we are pleased to provisionally empanel "),
    bold(opts.orgName),
    plain(" as a Business Associate of AFC India Limited."),
  ], S);
  await sdGap(e, 10);

  await sdPara(e, [bold("This provisional empanelment is subject to the following terms and conditions:")], S);
  await sdGap(e, 8);

  const terms: Segment[][] = [
    [plain("This is a provisional empanelment and shall not be construed as a final empanelment. The final empanelment letter will be issued upon successful completion of the due diligence process.")],
    [plain("This provisional empanelment is valid for a period of "),
      bold(`${opts.validityMonths} (${opts.validityMonths === 3 ? "three" : String(opts.validityMonths)}) months`),
      plain(" from the date of this letter, i.e., up to "),
      bold(opts.validUntil),
      plain(". If the final empanelment process is not completed within this period, this provisional empanelment shall automatically lapse.")],
    [plain("During the provisional period, your organization shall not represent itself as an empanelled Business Associate of AFC India Limited for any commercial, contractual, or marketing purpose without the prior written consent of AFC India Limited.")],
    [plain("AFC India Limited reserves the right to withdraw this provisional empanelment at any stage without assigning any reason, if it is found that the information provided by your organization is incorrect, misleading, or incomplete.")],
    [plain("No financial obligation or liability shall accrue to AFC India Limited by virtue of this provisional empanelment letter.")],
  ];

  for (let i = 0; i < terms.length; i++) {
    if (e.y < e.FOOTER_SAFE) await e.newPage();
    e.currentPage.drawText(`${i + 1}.`, { x: e.LEFT, y: e.y, size: S, font: fonts.bold, color: BLACK });
    await sdPara(e, terms[i], S, NI);
    await sdGap(e, 5);
  }

  await sdGap(e, 10);
  if (e.y < e.FOOTER_SAFE + 80) await e.newPage();

  await sdPara(e, [
    plain("We look forward to a productive and mutually beneficial association with "),
    bold(opts.orgName),
    plain(". Please acknowledge receipt of this letter and confirm your acceptance of the above terms and conditions."),
  ], S);
  await sdGap(e, 20);

  await sdLine(e, "Warm Regards,", S, false);
  await sdGap(e, 8);
  await sdLine(e, opts.signatoryName, S, true);
  await sdLine(e, opts.signatoryDesignation, S, false);
  await sdLine(e, "AFC India Limited", S, false);

  return await pdf.save();
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

  if (caller.role !== "dgm") return jsonRes(req, 403, { error: "Only a DGM can send the provisional empanelment letter." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const { application_id, otp } = body as { application_id?: string; otp?: unknown };
  if (!application_id || typeof application_id !== "string") return jsonRes(req, 400, { error: "application_id is required." });

  const { data: app, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, ba_email, team, sent_by, application_code, provisional_letter_sent")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  if (!isCallerOnTeam(caller, app.team)) return jsonRes(req, 403, { error: "Only the team's DGM can send the provisional letter for this application." });
  if (!ALLOWED_STATUSES.has(app.status)) return jsonRes(req, 400, { error: `The BA hasn't submitted their form yet, so there's nothing to send a letter for.` });
  if (app.provisional_letter_sent) return jsonRes(req, 400, { error: "A provisional letter has already been sent for this application." });

  const otpValid = await verifyOtp(adminClient, { userId: caller.id, applicationId: application_id, action: "provisional_letter", otp });
  if (!otpValid) return jsonRes(req, 400, { error: "Invalid or expired verification code. Please request a new one." });

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return jsonRes(req, 500, { error: "Email service not configured." });

  try {
    const { data: reg } = await adminClient
      .from("ba_registrations")
      .select("org_name, contact_person, designation, reg_address")
      .eq("application_id", application_id)
      .maybeSingle();
    if (!reg) return jsonRes(req, 400, { error: "The BA hasn't submitted their form yet." });

    const { data: dgmRow } = await adminClient.from("afc_users").select("full_name").eq("id", caller.id).maybeSingle();

    const logoUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/public-assets/Logo.png`;
    const logoRes = await fetch(logoUrl);
    if (!logoRes.ok) return jsonRes(req, 500, { error: "Could not load logo. Please try again." });
    const logoBytes = new Uint8Array(await logoRes.arrayBuffer());

    const today = new Date();
    const validUntil = addMonths(today, 3);
    const validUntilStr = formatDateLong(validUntil);
    const year = today.getFullYear();

    const { count } = await adminClient
      .from("empanelment_applications")
      .select("id", { count: "exact", head: true })
      .eq("provisional_letter_sent", true);
    const refNumber = `AFC/Provisional/${year}/${String((count ?? 0) + 1).padStart(3, "0")}`;

    const orgName = reg.org_name || "the Organization";
    const contactPerson = reg.contact_person || "Sir / Ma'am";

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await generateProvisionalPDF({
        logoBytes,
        refNumber,
        date: formatDateDDMMYYYY(today),
        contactPerson,
        designation: reg.designation || "Authorized Signatory",
        orgName,
        regAddress: reg.reg_address || "",
        applicationCode: app.application_code || "",
        signatoryName: (dgmRow?.full_name || "Deputy General Manager").toUpperCase(),
        signatoryDesignation: "DEPUTY GENERAL MANAGER",
        validUntil: validUntilStr,
        validityMonths: 3,
      });
    } catch (pdfErr) {
      console.error("PDF generation error:", pdfErr);
      return jsonRes(req, 500, { error: "Failed to generate PDF. Please try again." });
    }

    const { error: updateErr } = await adminClient
      .from("empanelment_applications")
      .update({ provisional_letter_sent: true, provisional_sent_at: today.toISOString() })
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
