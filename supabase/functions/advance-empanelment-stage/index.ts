// supabase/functions/advance-empanelment-stage/index.ts
// JWT must be ON. Single entry point for every stage-transition action in
// the review pipeline — centralizes the CFO/CS fan-in atomically (the old
// app did this as a race-prone client-side read-then-write) and keeps every
// transition's authorization + status-precondition check in one reviewable
// place instead of duplicated across 8 near-identical edge functions.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { escapeHtml, wrapEmailBody, sendResendEmail } from "../_shared/email.ts";
import { notifyUser, notifyRole, notifyTeam, emailRole, emailUser } from "../_shared/notify.ts";
import { verifyOtp } from "../_shared/otp.ts";
import {
  bytesToBase64, formatDateDDMMYYYY, formatDateLong, addMonths, BLACK,
  Segment, plain, bold, PageEngine, sd, sdLine, sdPara, sdGap, newPdfDoc,
} from "../_shared/letterPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

// Final Empanelment Letter — attached to the same email that carries the
// BA's portal credentials on MD accept. Distinct from the DGM's provisional
// letter (send-provisional-letter): this one is final, references the
// application's actual sectors, and is signed by the team's DGM. Ported
// from the previous AFC empanelment app's send-welcome-mail function.
async function generateEmpanelmentPDF(opts: {
  logoBytes: Uint8Array;
  refNumber: string;
  date: string;
  contactPerson: string;
  designation: string;
  orgName: string;
  regAddress: string;
  sectors: string;
  validUntil: string;
  dgmName: string;
}): Promise<Uint8Array> {
  const { pdf, fonts } = await newPdfDoc();
  const e = new PageEngine(pdf, fonts, opts.logoBytes);
  const S = 9.5;
  const NI = 18;

  await e.newPage();

  await sdLine(e, opts.dgmName, S, true);
  await sdLine(e, "DEPUTY GENERAL MANAGER", S, true);
  await sdGap(e, 20);

  e.drawTextAt(opts.refNumber, e.LEFT, S, true);
  e.drawTextRight(opts.date, S, true);
  e.gap(e.LINE_H);
  await sdGap(e, 20);

  await sdLine(e, "To,", S, false);
  await sdLine(e, opts.contactPerson, S, false);
  await sdLine(e, opts.designation, S, false);
  await sdLine(e, opts.orgName, S, false);
  for (const part of opts.regAddress.split(/[,\n]/).map((l: string) => l.trim()).filter(Boolean).slice(0, 3)) {
    await sdLine(e, part.length > 72 ? part.slice(0, 72) : part, S, false);
  }
  await sdGap(e, 14);

  await sdPara(e, [bold("Sub: "), plain("Empanelment as Business Associate — AFC India Limited")], S);
  await sdGap(e, 3);
  await sd(e, () => e.drawRule());
  await sdGap(e, 8);

  await sdLine(e, `Dear ${opts.contactPerson},`, S, false);
  await sdGap(e, 8);

  await sdPara(e, [
    plain("We are pleased to inform you that we have reviewed and evaluated the capabilities and qualifications of "),
    bold(opts.orgName),
    plain(", and we are pleased to officially empanel "),
    bold(opts.orgName),
    plain(" as an approved Business Associate of AFC India Limited for providing services in "),
    bold(opts.sectors),
    plain(" on mutually agreed terms and conditions and revenue/risk sharing basis."),
  ], S);
  await sdGap(e, 10);

  await sdPara(e, [plain("The said empanelment is subject to the following terms and conditions:")], S);
  await sdGap(e, 8);

  const clauses: Segment[][] = [
    [plain("Both the organizations agree to share resources available with either organization, to explore newer business avenues and share technical expertise wherever possible and required.")],
    [plain("This communication shall not be considered a Partnership / Joint Venture / Rights of business of either of the organization.")],
    [plain("Both organizations agree to place their logo in the activities conducted jointly. The request for placing the logo would be made by obtaining consent before actual use.")],
    [plain("During this period of work, the organization shall abide by all terms & conditions prescribed by AFC India Limited from time to time.")],
    [plain("Neither organization shall use the intellectual property, trademarks, or brand names of the other, without prior written consent.")],
    [plain("Neither organization i.e., AFC nor "), bold(opts.orgName), plain(" shall incur any liability on behalf of the other, without prior written consent.")],
    [plain("Either organization i.e., AFC or "), bold(opts.orgName), plain(" shall not propagate this communication to further business interests without consent of the other.")],
    [plain("Both organizations will enter into separate agreements for each assignment with clear-cut roles, payment, commercials, terms, and deliverables.")],
    [plain("No information or document acquired while working together may be disclosed to a third organization without written consent.")],
    [plain("The empanelment does not grant any exclusive right to either organization and shall not create any legally binding obligations.")],
    [plain("The empanelment can be terminated by either organization by serving a 30-day notice in writing, subject to completion of assignments in hand.")],
    [plain("This empanelment is valid for a period of "), bold("3 (three) years"), plain(" from the date of this letter, i.e., up to "), bold(opts.validUntil), plain(", and is subject to renewal on mutual consent.")],
  ];

  for (let i = 0; i < clauses.length; i++) {
    if (e.y < e.FOOTER_SAFE) await e.newPage();
    e.currentPage.drawText(`${i + 1}.`, { x: e.LEFT, y: e.y, size: S, font: fonts.bold, color: BLACK });
    await sdPara(e, clauses[i], S, NI);
    await sdGap(e, 5);
  }

  await sdGap(e, 10);
  if (e.y < e.FOOTER_SAFE + 80) await e.newPage();

  await sdPara(e, [
    plain("Looking forward to a fruitful and mutually beneficial co-operation with "),
    bold(opts.orgName), plain(" for taking business opportunities together."),
  ], S);
  await sdGap(e, 20);

  await sdLine(e, "Warm Regards,", S, false);
  await sdGap(e, 8);
  await sdLine(e, opts.dgmName, S, true);
  await sdLine(e, "DEPUTY GENERAL MANAGER", S, false);
  await sdLine(e, "AFC India Limited", S, false);

  return await pdf.save();
}

// CFO/CS previously only got the in-app bell notification when an
// application reached their stage — this adds an actual email so it isn't
// missed if they haven't opened the app.
// Generic "your action is needed" email — used for every stage handoff
// besides the CFO/CS one above (which has its own copy), so the PO/DGM/MD
// get a real email (not just the in-app bell) whenever the application
// lands in their queue.
function actionRequiredEmailHtml(orgName: string, applicationId: string, actionPhrase: string): string {
  const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";
  return wrapEmailBody(`
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear Sir / Ma'am,</p>
    <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
      The empanelment application submitted by <strong>${escapeHtml(orgName)}</strong> needs you to ${escapeHtml(actionPhrase)}.
    </p>
    <p style="margin:0 0 8px;">
      <a href="${siteUrl}/empanelment/${applicationId}" style="display:inline-block;background:#1a5fd4;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:13px;">Review Application &rarr;</a>
    </p>
  `);
}

function cfoCsReviewEmailHtml(orgName: string, applicationId: string): string {
  const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";
  return wrapEmailBody(`
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear Sir / Ma'am,</p>
    <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
      The empanelment application submitted by <strong>${escapeHtml(orgName)}</strong> is awaiting your review.
    </p>
    <p style="margin:0 0 8px;">
      <a href="${siteUrl}/empanelment/${applicationId}" style="display:inline-block;background:#1a5fd4;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:13px;">Review Application &rarr;</a>
    </p>
  `);
}

async function logActivity(admin: AdminClient, applicationId: string, actorId: string, actorRole: string, action: string, comment: string | null) {
  await admin.from("empanelment_activity_log").insert({ application_id: applicationId, actor_id: actorId, actor_role: actorRole, action, comment });
}

function generateTempPassword(length = 14): string {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+";
  const all = lower + upper + digits + symbols;

  function randomChar(charset: string): string {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return charset[bytes[0] % charset.length];
  }

  let pw = randomChar(lower) + randomChar(upper) + randomChar(digits) + randomChar(symbols);
  while (pw.length < length) pw += randomChar(all);

  const chars = pw.split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const j = bytes[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// Creates the BA's portal login on acceptance. Best-effort: any failure here
// is logged and swallowed — it must never block the MD's accept action.
// Returns the temp password to include in the decision email, or null if an
// account already existed (nothing new to email) or provisioning failed.
async function provisionBaAccount(
  admin: AdminClient,
  applicationId: string,
  baEmail: string,
  orgName: string,
  contactPerson: string | null,
  applicationTeam: string
): Promise<string | null> {
  const { data: existing } = await admin.from("afc_users").select("id, team").eq("email", baEmail).maybeSingle();
  if (existing) {
    await admin.from("empanelment_applications").update({ ba_user_id: existing.id }).eq("id", applicationId);
    // Backfills a pre-existing BA account provisioned before team-scoping was
    // added — never overwrites a team it already has.
    if (!existing.team) {
      await admin.from("afc_users").update({ team: applicationTeam }).eq("id", existing.id);
    }
    return null;
  }

  const tempPassword = generateTempPassword();
  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email: baEmail,
    password: tempPassword,
    email_confirm: true,
  });
  if (authErr || !authUser?.user) {
    console.error("Failed to create BA auth account:", authErr?.message);
    return null;
  }

  const { error: profileErr } = await admin.from("afc_users").insert({
    id: authUser.user.id,
    full_name: contactPerson || orgName,
    email: baEmail,
    role: "business_associate",
    team: applicationTeam,
    is_active: true,
    must_change_password: true,
  });
  if (profileErr) {
    console.error("Failed to create BA profile row:", profileErr.message);
    await admin.auth.admin.deleteUser(authUser.user.id).catch(() => {});
    return null;
  }

  await admin.from("empanelment_applications").update({ ba_user_id: authUser.user.id }).eq("id", applicationId);
  return tempPassword;
}

// Best-effort: a logo-fetch or PDF-generation hiccup must never block the
// MD's accept action — falls back to null, and sendDecisionMail just sends
// the credentials email without an attachment (same as before this letter
// existed).
async function tryBuildEmpanelmentLetter(
  admin: AdminClient,
  app: { id: string; application_code: string; team: string; dgm_id: string | null },
  baData: { org_name: string | null; contact_person: string | null; designation: string | null; reg_address: string | null; sectors_served: unknown } | null
): Promise<{ attachment: { filename: string; content: string }; refNumber: string; validUntil: string } | null> {
  try {
    if (!baData) return null;

    let dgmName: string | null = null;
    if (app.dgm_id) {
      const { data } = await admin.from("afc_users").select("full_name").eq("id", app.dgm_id).maybeSingle();
      dgmName = data?.full_name || null;
    }
    if (!dgmName) {
      const { data } = await admin.from("afc_users").select("full_name").eq("team", app.team).eq("role", "dgm").eq("is_active", true).limit(1).maybeSingle();
      dgmName = data?.full_name || null;
    }

    const logoUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/public-assets/Logo.png`;
    const logoRes = await fetch(logoUrl);
    if (!logoRes.ok) return null;
    const logoBytes = new Uint8Array(await logoRes.arrayBuffer());

    const today = new Date();
    const validUntilDate = addMonths(today, 36); // 3 years
    const validUntil = formatDateLong(validUntilDate);
    const year = today.getFullYear();

    const { count } = await admin.from("empanelment_applications").select("id", { count: "exact", head: true }).not("empanelment_ref", "is", null);
    const refNumber = `AFC/BA/${year}/${String((count ?? 0) + 1).padStart(3, "0")}`;

    const sectorsArr = Array.isArray(baData.sectors_served) ? baData.sectors_served as string[] : [];
    const sectors = sectorsArr.length ? sectorsArr.join(", ") + " and other areas of common interest" : "areas of common interest as may be mutually agreed";

    const pdfBytes = await generateEmpanelmentPDF({
      logoBytes,
      refNumber,
      date: formatDateDDMMYYYY(today),
      contactPerson: baData.contact_person ? `Mr./Ms. ${baData.contact_person}` : "Sir / Ma'am",
      designation: baData.designation || "Authorized Signatory",
      orgName: baData.org_name || "the Organization",
      regAddress: baData.reg_address || "",
      sectors,
      validUntil,
      dgmName: (dgmName || "Deputy General Manager").toUpperCase(),
    });

    await admin.from("empanelment_applications").update({ empanelment_ref: refNumber, empanelment_expires_at: validUntilDate.toISOString() }).eq("id", app.id);

    return {
      attachment: { filename: `Empanelment_Letter_${refNumber.replace(/\//g, "_")}.pdf`, content: bytesToBase64(pdfBytes) },
      refNumber,
      validUntil,
    };
  } catch (err) {
    console.error("Empanelment letter generation failed:", (err as Error).message);
    return null;
  }
}

async function sendDecisionMail(
  orgName: string,
  baEmail: string,
  accepted: boolean,
  remarks: string,
  credentials?: string | null,
  letterAttachment?: { filename: string; content: string } | null
) {
  const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";
  const html = wrapEmailBody(
    accepted
      ? `
        <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear Sir / Ma'am,</p>
        <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
          We are pleased to inform you that the empanelment application submitted by <strong>${escapeHtml(orgName)}</strong> has been <strong style="color:#15803d;">approved</strong>.
        </p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:0 0 20px;">
          <p style="margin:0;font-size:13px;color:#166534;line-height:1.7;">${escapeHtml(remarks)}</p>
        </div>
        ${letterAttachment ? `<p style="margin:0 0 20px;font-size:13px;color:#374151;">Please find the official <strong>Empanelment Letter</strong> attached to this email.</p>` : `<p style="margin:0 0 20px;font-size:13px;color:#374151;">AFC India Limited will be in touch with next steps shortly.</p>`}
        ${credentials ? `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px 24px;margin:0 0 8px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.08em;">Your Portal Login</p>
          <p style="margin:0 0 4px;font-size:13px;color:#374151;">Email: <strong>${escapeHtml(baEmail)}</strong></p>
          <p style="margin:0 0 14px;font-size:13px;color:#374151;">Temporary Password: <strong style="font-family:monospace;">${escapeHtml(credentials)}</strong></p>
          <p style="margin:0 0 12px;">
            <a href="${siteUrl}/login" style="display:inline-block;background:#1a5fd4;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:13px;">Log In &rarr;</a>
          </p>
          <p style="margin:0;font-size:12px;color:#6b7280;">You will be asked to set a new password the first time you log in.</p>
        </div>` : ""}
      `
      : `
        <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear Sir / Ma'am,</p>
        <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
          We regret to inform you that the empanelment application submitted by <strong>${escapeHtml(orgName)}</strong> has been <strong style="color:#dc2626;">rejected</strong>.
        </p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin:0 0 20px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.08em;">Remarks</p>
          <p style="margin:0;font-size:13px;color:#7f1d1d;line-height:1.7;">${escapeHtml(remarks)}</p>
        </div>
        <p style="margin:0;font-size:13px;color:#374151;">For queries, contact us at afc@afcindia.org.in.</p>
      `
  );
  return sendResendEmail({
    to: baEmail,
    subject: accepted ? "Empanelment Approved — AFC India Limited" : "Empanelment Application Status — AFC India Limited",
    html,
    ...(letterAttachment ? { attachments: [letterAttachment] } : {}),
  });
}

// Exported (rather than only the anonymous callback passed to `serve`) so
// tests can call it directly with a fake admin client injected — see
// index.test.ts.
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

  const { application_id, action, comment } = body;
  if (!application_id || typeof application_id !== "string") return jsonRes(req, 400, { error: "application_id is required." });
  if (!action || typeof action !== "string") return jsonRes(req, 400, { error: "action is required." });
  const trimmedComment = typeof comment === "string" ? comment.trim() : "";

  const { data: app, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, ba_email, team, project_officer_id, dgm_id, sent_by, cfo_reviewed, cs_reviewed")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  const { data: baData } = await adminClient
    .from("ba_registrations")
    .select("id, org_name, contact_person, designation, reg_address, sectors_served")
    .eq("application_id", application_id)
    .maybeSingle();
  const orgName = baData?.org_name || app.ba_email;

  function forbidden(msg: string) {
    return jsonRes(req, 403, { error: msg });
  }
  function badState(expected: string) {
    return jsonRes(req, 400, { error: `This application is in "${app.status}" status, not "${expected}". It may have just been updated by someone else — refresh and try again.` });
  }

  try {
    switch (action) {
      case "po_forward": {
        if (caller.role !== "project_officer" || caller.id !== app.project_officer_id) return forbidden("Only the assigned Project Officer can forward this application.");
        if (app.status !== "po_review") return badState("po_review");
        if (!trimmedComment) return jsonRes(req, 400, { error: "A comment is required." });
        await adminClient.from("empanelment_applications").update({ status: "cfo_cs_review", po_comment: trimmedComment }).eq("id", app.id);
        await logActivity(adminClient, app.id, caller.id, caller.role, "po_forwarded", trimmedComment);
        const forwardPayload = {
          title: "Empanelment application awaiting your review",
          sub_text: `${orgName}'s application was forwarded by the Project Officer.`,
          type: "action_required",
          link: `/empanelment/${app.id}`,
        };
        await notifyRole(adminClient, "cfo", forwardPayload);
        await notifyRole(adminClient, "cs", forwardPayload);
        const forwardMail = { subject: "Empanelment Application Awaiting Your Review — AFC India Limited", html: cfoCsReviewEmailHtml(orgName, app.id) };
        await emailRole(adminClient, "cfo", forwardMail);
        await emailRole(adminClient, "cs", forwardMail);
        return jsonRes(req, 200, { success: true, status: "cfo_cs_review" });
      }

      case "cfo_review":
      case "cs_review": {
        const isCfo = action === "cfo_review";
        if (caller.role !== (isCfo ? "cfo" : "cs")) return forbidden(`Only the ${isCfo ? "CFO" : "CS"} can submit this review.`);
        if (app.status !== "cfo_cs_review") return badState("cfo_cs_review");
        if (isCfo && app.cfo_reviewed) return jsonRes(req, 400, { error: "You have already reviewed this application." });
        if (!isCfo && app.cs_reviewed) return jsonRes(req, 400, { error: "You have already reviewed this application." });
        if (!trimmedComment) return jsonRes(req, 400, { error: "A comment is required." });

        const otherDone = isCfo ? app.cs_reviewed : app.cfo_reviewed;
        const update: Record<string, unknown> = isCfo ? { cfo_comment: trimmedComment, cfo_reviewed: true } : { cs_comment: trimmedComment, cs_reviewed: true };
        if (otherDone) update.status = "po_final_review";

        await adminClient.from("empanelment_applications").update(update).eq("id", app.id);
        await logActivity(adminClient, app.id, caller.id, caller.role, isCfo ? "cfo_reviewed" : "cs_reviewed", trimmedComment);
        if (otherDone) {
          await notifyUser(adminClient, app.project_officer_id, {
            title: "Empanelment application awaiting your review",
            sub_text: `${orgName}'s application cleared CFO and CS review. Please give it a final look before forwarding to the DGM.`,
            type: "action_required",
            link: `/empanelment/${app.id}`,
          });
          await emailUser(adminClient, app.project_officer_id, {
            subject: "Empanelment Application Awaiting Your Final Review — AFC India Limited",
            html: actionRequiredEmailHtml(orgName, app.id, "give it a final look before forwarding to the DGM, now that CFO and CS review is complete"),
          });
        }
        return jsonRes(req, 200, { success: true, status: otherDone ? "po_final_review" : "cfo_cs_review", forwarded: !!otherDone });
      }

      case "po_resend_cfo_cs": {
        if (caller.role !== "project_officer" || caller.id !== app.project_officer_id) return forbidden("Only the assigned Project Officer can send this back to CFO and CS.");
        if (app.status !== "po_final_review") return badState("po_final_review");
        await adminClient.from("empanelment_applications").update({
          status: "cfo_cs_review",
          cfo_reviewed: false,
          cs_reviewed: false,
          cfo_comment: null,
          cs_comment: null,
        }).eq("id", app.id);
        await logActivity(adminClient, app.id, caller.id, caller.role, "po_resent_cfo_cs", trimmedComment || "Sent back to CFO and CS for a fresh review.");
        const resendPayload = {
          title: "Empanelment application sent back for review",
          sub_text: `${orgName}'s application was sent back by the Project Officer for a fresh look.`,
          type: "action_required",
          link: `/empanelment/${app.id}`,
        };
        await notifyRole(adminClient, "cfo", resendPayload);
        await notifyRole(adminClient, "cs", resendPayload);
        const resendMail = { subject: "Empanelment Application Awaiting Your Review — AFC India Limited", html: cfoCsReviewEmailHtml(orgName, app.id) };
        await emailRole(adminClient, "cfo", resendMail);
        await emailRole(adminClient, "cs", resendMail);
        return jsonRes(req, 200, { success: true, status: "cfo_cs_review" });
      }

      case "po_final_forward": {
        if (caller.role !== "project_officer" || caller.id !== app.project_officer_id) return forbidden("Only the assigned Project Officer can forward this application.");
        if (app.status !== "po_final_review") return badState("po_final_review");
        await adminClient.from("empanelment_applications").update({ status: "dgm_review", po_final_comment: trimmedComment || null }).eq("id", app.id);
        await logActivity(adminClient, app.id, caller.id, caller.role, "po_final_forwarded", trimmedComment || "Forwarded to DGM.");
        const dgmPayload = {
          title: "Empanelment application awaiting your review",
          sub_text: `${orgName}'s application was forwarded by the Project Officer.`,
          type: "action_required",
          link: `/empanelment/${app.id}`,
        };
        if (app.dgm_id) {
          await notifyUser(adminClient, app.dgm_id, dgmPayload);
          await emailUser(adminClient, app.dgm_id, {
            subject: "Empanelment Application Awaiting Your Review — AFC India Limited",
            html: actionRequiredEmailHtml(orgName, app.id, "review it"),
          });
        } else {
          await notifyRole(adminClient, "dgm", dgmPayload, app.team);
          await emailRole(adminClient, "dgm", {
            subject: "Empanelment Application Awaiting Your Review — AFC India Limited",
            html: actionRequiredEmailHtml(orgName, app.id, "review it"),
          }, app.team);
        }
        return jsonRes(req, 200, { success: true, status: "dgm_review" });
      }

      case "dgm_recommend": {
        if (caller.role !== "dgm" || caller.team !== app.team) return forbidden("Only the team's DGM can act on this application.");
        if (app.status !== "dgm_review") return badState("dgm_review");
        if (!trimmedComment) return jsonRes(req, 400, { error: "A comment is required." });
        await adminClient.from("empanelment_applications").update({ status: "md_review", dgm_comment: trimmedComment }).eq("id", app.id);
        await logActivity(adminClient, app.id, caller.id, caller.role, "dgm_recommended", trimmedComment);
        await notifyRole(adminClient, "md", {
          title: "Empanelment application awaiting your decision",
          sub_text: `${orgName}'s application was recommended by the DGM and is ready for a final decision.`,
          type: "action_required",
          link: `/empanelment/${app.id}`,
        });
        await emailRole(adminClient, "md", {
          subject: "Empanelment Application Awaiting Your Decision — AFC India Limited",
          html: actionRequiredEmailHtml(orgName, app.id, "make a final decision — the DGM has recommended this application"),
        });
        return jsonRes(req, 200, { success: true, status: "md_review" });
      }

      case "dgm_send_back": {
        if (caller.role !== "dgm" || caller.team !== app.team) return forbidden("Only the team's DGM can act on this application.");
        if (app.status !== "dgm_review") return badState("dgm_review");
        await adminClient.from("empanelment_applications").update({ status: "po_final_review" }).eq("id", app.id);
        await logActivity(adminClient, app.id, caller.id, caller.role, "dgm_sent_back", trimmedComment || "Sent back to Project Officer for another look.");
        await notifyUser(adminClient, app.project_officer_id, {
          title: "Empanelment application sent back",
          sub_text: `${orgName}'s application was sent back by the DGM for another look.`,
          type: "action_required",
          link: `/empanelment/${app.id}`,
        });
        await emailUser(adminClient, app.project_officer_id, {
          subject: "Empanelment Application Sent Back — AFC India Limited",
          html: actionRequiredEmailHtml(orgName, app.id, "take another look — it was sent back by the DGM"),
        });
        return jsonRes(req, 200, { success: true, status: "po_final_review" });
      }

      case "md_send_back": {
        if (caller.role !== "md") return forbidden("Only the MD can act at this stage.");
        if (app.status !== "md_review") return badState("md_review");
        await adminClient.from("empanelment_applications").update({ status: "dgm_review" }).eq("id", app.id);
        await logActivity(adminClient, app.id, caller.id, caller.role, "md_sent_back", trimmedComment || "Sent back to the DGM for another look.");
        const sendBackPayload = {
          title: "Empanelment application sent back",
          sub_text: `${orgName}'s application was sent back by the MD for another look.`,
          type: "action_required",
          link: `/empanelment/${app.id}`,
        };
        const sendBackMail = {
          subject: "Empanelment Application Sent Back — AFC India Limited",
          html: actionRequiredEmailHtml(orgName, app.id, "take another look — it was sent back by the MD"),
        };
        if (app.dgm_id) {
          await notifyUser(adminClient, app.dgm_id, sendBackPayload);
          await emailUser(adminClient, app.dgm_id, sendBackMail);
        } else {
          await notifyRole(adminClient, "dgm", sendBackPayload, app.team);
          await emailRole(adminClient, "dgm", sendBackMail, app.team);
        }
        return jsonRes(req, 200, { success: true, status: "dgm_review" });
      }

      // DGMs can no longer reject directly — kept as an explicit case
      // (rather than falling through to "Unknown action") so the intent is
      // clear if this is ever hit directly, e.g. a stale client.
      case "dgm_reject": {
        return forbidden("DGMs can no longer reject applications directly. Send it back to the Project Officer, or forward it to the MD for a final decision.");
      }

      case "md_reject": {
        if (caller.role !== "md") return forbidden("Only the MD can reject at this stage.");
        if (app.status !== "md_review") return badState("md_review");
        if (!trimmedComment) return jsonRes(req, 400, { error: "Rejection remarks are required." });

        const otpValid = await verifyOtp(adminClient, { userId: caller.id, applicationId: app.id, action: "md_reject", otp: body.otp });
        if (!otpValid) return jsonRes(req, 400, { error: "Invalid or expired verification code. Please request a new one." });

        await adminClient.from("empanelment_applications").update({ status: "rejected", md_remarks: trimmedComment, decided_at: new Date().toISOString() }).eq("id", app.id);
        const emailSent = await sendDecisionMail(orgName, app.ba_email, false, trimmedComment);
        await logActivity(adminClient, app.id, caller.id, caller.role, "md_rejected", trimmedComment);
        // Whole team, not just the AC who sent the invite — the team should
        // know an application they worked on was ultimately rejected.
        await notifyTeam(adminClient, app.team, {
          title: "Empanelment application rejected",
          sub_text: `${orgName}'s application was rejected by the MD. Remarks: ${trimmedComment}`,
          type: "info",
          link: `/empanelment/${app.id}`,
        }, caller.id);
        return jsonRes(req, 200, { success: true, status: "rejected", email_sent: emailSent });
      }

      case "md_accept": {
        if (caller.role !== "md") return forbidden("Only the MD can accept this application.");
        if (app.status !== "md_review") return badState("md_review");
        if (!trimmedComment) return jsonRes(req, 400, { error: "Remarks are required." });

        const otpValid = await verifyOtp(adminClient, { userId: caller.id, applicationId: app.id, action: "md_accept", otp: body.otp });
        if (!otpValid) return jsonRes(req, 400, { error: "Invalid or expired verification code. Please request a new one." });

        await adminClient.from("empanelment_applications").update({ status: "accepted", md_remarks: trimmedComment, decided_at: new Date().toISOString() }).eq("id", app.id);
        const credentials = await provisionBaAccount(adminClient, app.id, app.ba_email, orgName, baData?.contact_person || null, app.team);
        const letter = await tryBuildEmpanelmentLetter(adminClient, app, baData);
        const emailSent = await sendDecisionMail(orgName, app.ba_email, true, trimmedComment, credentials, letter?.attachment);
        await logActivity(
          adminClient,
          app.id,
          caller.id,
          caller.role,
          emailSent ? "md_accepted" : "md_accepted_email_failed",
          letter ? `${trimmedComment} (Empanelment Letter Ref: ${letter.refNumber}, valid until ${letter.validUntil})` : trimmedComment
        );
        const acceptedPayload = {
          title: "Empanelment application accepted",
          sub_text: `${orgName}'s application was accepted by the MD.`,
          type: "info",
          link: `/empanelment/${app.id}`,
        };
        await notifyUser(adminClient, app.sent_by, acceptedPayload);
        await notifyTeam(adminClient, app.team, acceptedPayload, caller.id);
        return jsonRes(req, 200, { success: true, status: "accepted", email_sent: emailSent, ba_account_created: !!credentials });
      }

      default:
        return jsonRes(req, 400, { error: `Unknown action "${action}".` });
    }
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

// AFC_EDGE_TEST is never set in any real deployment — only by the test
// command (see supabase/functions/deno.json) — so this is a no-op guard in
// production and only skips the real network listener when a test file
// imports this module to call `handleRequest` directly with a fake client.
// Wrapped rather than passed directly — `serve` invokes its handler with a
// second `connInfo` argument, which would otherwise land in `adminClient`'s
// slot and silently shadow the default real client.
if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
