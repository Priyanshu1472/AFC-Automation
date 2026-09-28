// supabase/functions/send-support-request/index.ts
// JWT must be ON. Fired by the navbar's Support widget (see
// src/components/shared/SupportWidget.jsx) — any signed-in user describes an
// issue and it's emailed straight to SUPPORT_EMAIL (falls back to
// support@pmis.afcindia.org.in if that secret isn't set). No DB row is kept;
// this is a one-way notice, same as send-ba-document-request.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { escapeHtml, wrapEmailBody, sendResendEmail } from "../_shared/email.ts";

const FALLBACK_SUPPORT_EMAIL = "support@pmis.afcindia.org.in";

const ROLE_LABELS: Record<string, string> = {
  md: "Managing Director",
  executive_director: "Executive Director",
  admin: "Administrator",
  cfo: "Chief Financial Officer",
  cs: "Company Secretary",
  general_manager: "General Manager",
  dgm: "Deputy General Manager",
  agm: "Assistant General Manager",
  srm: "Senior Regional Manager",
  regional_manager: "Regional Manager",
  area_manager: "Area Manager",
  project_officer: "Project Officer",
  associate_consultant: "Associate Consultant",
  project_assistant: "Project Assistant",
  business_associate: "Business Partner",
};

const MAX_MESSAGE_LEN = 4000;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB raw, per file

type Attachment = { filename: string; content: string; contentType?: string };

function base64ByteLength(base64: string): number {
  const clean = base64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
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

  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : "";
  if (!message) return jsonRes(req, 400, { error: "Please describe the issue before sending." });

  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    return jsonRes(req, 400, { error: `You can attach up to ${MAX_ATTACHMENTS} images.` });
  }

  const attachments: Attachment[] = [];
  for (const raw of rawAttachments) {
    if (!raw || typeof raw !== "object") return jsonRes(req, 400, { error: "Invalid attachment." });
    const rec = raw as Record<string, unknown>;
    const filename: string = typeof rec.filename === "string" ? rec.filename : "";
    const content: string = typeof rec.content === "string" ? rec.content : "";
    const contentType: string = typeof rec.contentType === "string" ? rec.contentType : "";
    if (!filename || !content) return jsonRes(req, 400, { error: "Invalid attachment." });
    if (!contentType.startsWith("image/")) return jsonRes(req, 400, { error: "Only image attachments are allowed." });
    if (base64ByteLength(content) > MAX_ATTACHMENT_BYTES) {
      return jsonRes(req, 400, { error: `"${filename}" is too large — each image must be under 5MB.` });
    }
    attachments.push({ filename, content, contentType });
  }

  try {
    const { data: fullCaller } = await adminClient.from("afc_users").select("full_name").eq("id", caller.id).maybeSingle();
    const senderName = fullCaller?.full_name || caller.email;
    const roleLabel = ROLE_LABELS[caller.role] || caller.role;
    const sentAt = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

    const supportEmail = Deno.env.get("SUPPORT_EMAIL") || FALLBACK_SUPPORT_EMAIL;

    const html = wrapEmailBody(`
      <p style="margin:0 0 16px;font-size:14px;color:#374151;">A support request was submitted from the AFC Portal.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;font-size:13px;color:#374151;">
        <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">From</td><td><strong>${escapeHtml(senderName)}</strong> (${escapeHtml(caller.email)})</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Role</td><td>${escapeHtml(roleLabel)}${caller.team ? ` &middot; ${escapeHtml(caller.team)}` : ""}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Sent</td><td>${escapeHtml(sentAt)}</td></tr>
      </table>
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151;">Message</p>
      <p style="margin:0;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;color:#374151;white-space:pre-wrap;line-height:1.7;">${escapeHtml(message)}</p>
      ${attachments.length ? `<p style="margin:16px 0 0;font-size:12px;color:#6b7280;">${attachments.length} image${attachments.length > 1 ? "s" : ""} attached.</p>` : ""}
    `);

    const emailSent = await sendResendEmail({
      to: supportEmail,
      cc: caller.email,
      subject: `Support request from ${senderName} — AFC Portal`,
      html,
      attachments: attachments.length ? attachments.map((a) => ({ filename: a.filename, content: a.content })) : undefined,
    });

    if (!emailSent) return jsonRes(req, 500, { error: "Failed to send. Please try again." });

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
