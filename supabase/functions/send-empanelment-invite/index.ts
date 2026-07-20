// supabase/functions/send-empanelment-invite/index.ts
// JWT must be ON. Caller must be an active associate_consultant.
// Generates a 5-digit application code, creates the empanelment_applications
// row, and emails the BA the invite + code.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { escapeHtml, wrapEmailBody, sendResendEmail } from "../_shared/email.ts";
import { notifyUser } from "../_shared/notify.ts";

const ROLE_LABELS: Record<string, string> = {
  md: "Managing Director",
  cfo: "Chief Financial Officer",
  cs: "Company Secretary",
  dgm: "Deputy General Manager",
  agm: "Assistant General Manager",
  srm: "Senior Regional Manager",
  project_officer: "Project Officer",
  associate_consultant: "Associate Consultant",
};

function generateAppCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(10000 + (arr[0] % 90000));
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const adminClient = createAdminClient();
  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  if (caller.role !== "associate_consultant") {
    return jsonRes(req, 403, { error: "Only Associate Consultants can send empanelment invitations." });
  }
  if (!caller.team) {
    return jsonRes(req, 400, { error: "You are not assigned to a team. Please contact your DGM." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const { ba_email, project_officer_id } = body;
  if (!ba_email || typeof ba_email !== "string" || !isValidEmail(ba_email)) {
    return jsonRes(req, 400, { error: "A valid BA email is required." });
  }
  if (!project_officer_id || typeof project_officer_id !== "string") {
    return jsonRes(req, 400, { error: "Project Officer is required." });
  }

  const normalizedEmail = ba_email.trim().toLowerCase();

  try {
    // Project Officer must be an active PO on the caller's own team.
    const { data: po, error: poErr } = await adminClient
      .from("afc_users")
      .select("id, full_name, email")
      .eq("id", project_officer_id)
      .eq("role", "project_officer")
      .eq("team", caller.team)
      .eq("is_active", true)
      .maybeSingle();
    if (poErr || !po) return jsonRes(req, 400, { error: "Invalid Project Officer for your team." });

    const { data: dgm } = await adminClient
      .from("afc_users")
      .select("id, full_name")
      .eq("role", "dgm")
      .eq("team", caller.team)
      .eq("is_active", true)
      .maybeSingle();

    // One active (non-terminal) invitation per BA email at a time.
    const { data: existing } = await adminClient
      .from("empanelment_applications")
      .select("id, status, application_code")
      .eq("ba_email", normalizedEmail)
      .not("status", "in", '("rejected","accepted")')
      .limit(1)
      .maybeSingle();
    if (existing) {
      return jsonRes(req, 400, {
        error: `This email already has an active invitation (Code: ${existing.application_code}, Status: ${existing.status}).`,
      });
    }

    const applicationCode = generateAppCode();

    const { data: app, error: insertErr } = await adminClient
      .from("empanelment_applications")
      .insert({
        application_code: applicationCode,
        status: "sent",
        ba_email: normalizedEmail,
        team: caller.team,
        office: caller.office,
        sent_by: caller.id,
        project_officer_id: po.id,
        dgm_id: dgm?.id || null,
      })
      .select("id")
      .single();
    if (insertErr) throw new Error("Failed to save invitation: " + insertErr.message);

    const advisedByName = dgm?.full_name || "AFC India Limited";
    const advisedByDesig = dgm ? ROLE_LABELS["dgm"] : ROLE_LABELS[caller.role] || caller.role;
    const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";

    const html = wrapEmailBody(`
      <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear Sir / Ma'am,</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">Greetings from AFC India Limited!</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
        As advised by <strong>${escapeHtml(advisedByName)}</strong> (${escapeHtml(advisedByDesig)}), please find enclosed the link for the
        Business Associate (BA) empanelment form for your kind perusal.
      </p>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.08em;">Your Application Code</p>
        <p style="margin:0;font-size:22px;font-weight:700;color:#111827;font-family:monospace;letter-spacing:0.1em;">${escapeHtml(applicationCode)}</p>
      </div>
      <p style="margin:0 0 8px;">
        <a href="${siteUrl}/ba-form" style="display:inline-block;background:#1a5fd4;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:14px;">Open Empanelment Form &rarr;</a>
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#374151;line-height:1.7;">Keep this code safe — you will need it to submit the form.</p>
    `);

    const emailSent = await sendResendEmail({
      to: normalizedEmail,
      subject: "Business Associate Empanelment Form — AFC India Limited",
      html,
    });

    await adminClient.from("empanelment_activity_log").insert({
      application_id: app.id,
      actor_id: caller.id,
      actor_role: caller.role,
      action: emailSent ? "sent" : "sent_email_failed",
      comment: `Invitation sent to ${normalizedEmail}.`,
    });

    await notifyUser(adminClient, po.id, {
      title: "New empanelment invite sent",
      sub_text: `An invite was sent to ${normalizedEmail}. You're assigned as the reviewing Project Officer.`,
      type: "info",
      link: `/empanelment/${app.id}`,
    });
    if (dgm?.id) {
      await notifyUser(adminClient, dgm.id, {
        title: "New empanelment invite sent",
        sub_text: `An invite was sent to ${normalizedEmail} on your team.`,
        type: "info",
        link: `/empanelment/${app.id}`,
      });
    }

    return jsonRes(req, 200, { success: true, email_sent: emailSent, application_id: app.id });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
});
