// supabase/functions/raise-empanelment-hold/index.ts
// JWT must be ON. Caller must be the assigned PO/DGM, or MD, acting at the
// stage where they're the active reviewer. Puts the application on hold,
// records one compliance_flags row per flagged field, and emails the BA a
// link + reminder of their application code to submit a correction.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile, isCallerOnTeam } from "../_shared/auth.ts";
import { escapeHtml, wrapEmailBody, sendResendEmail } from "../_shared/email.ts";
import { isValidFieldKey, labelForFieldKey } from "../_shared/empanelmentFields.ts";
import { notifyUser } from "../_shared/notify.ts";

const ALLOWED_STATUS_BY_ROLE: Record<string, string[]> = {
  project_officer: ["po_review", "po_final_review"],
  dgm: ["dgm_review"],
  md: ["md_review"],
};

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  if (!(caller.role in ALLOWED_STATUS_BY_ROLE)) {
    return jsonRes(req, 403, { error: "Only a Project Officer, DGM, or MD can raise a compliance hold." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const { application_id, flags } = body as { application_id?: string; flags?: Array<{ field_key: string; comment: string }> };
  if (!application_id || typeof application_id !== "string") return jsonRes(req, 400, { error: "application_id is required." });
  if (!Array.isArray(flags) || flags.length === 0) return jsonRes(req, 400, { error: "At least one flagged field is required." });

  for (const f of flags) {
    if (!f?.field_key || !isValidFieldKey(f.field_key)) return jsonRes(req, 400, { error: `"${f?.field_key}" is not a flaggable field.` });
    if (!f?.comment?.trim()) return jsonRes(req, 400, { error: "Every flagged field needs a comment explaining the issue." });
  }

  const { data: app, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, ba_email, team, project_officer_id, dgm_id, sent_by")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  if (caller.role === "project_officer" && caller.id !== app.project_officer_id) return jsonRes(req, 403, { error: "Only the assigned Project Officer can raise a hold on this application." });
  if (caller.role === "dgm" && !isCallerOnTeam(caller, app.team)) return jsonRes(req, 403, { error: "Only the team's DGM can raise a hold on this application." });

  const allowedStatuses = ALLOWED_STATUS_BY_ROLE[caller.role];
  if (!allowedStatuses.includes(app.status)) {
    return jsonRes(req, 400, { error: `You can only raise a hold while this application is awaiting your review (current status: "${app.status}").` });
  }

  const { data: baData } = await adminClient.from("ba_registrations").select("org_name").eq("application_id", application_id).maybeSingle();
  const orgName = baData?.org_name || app.ba_email;

  try {
    const holdBatchId = crypto.randomUUID();
    const flagRows = flags.map((f) => ({
      application_id,
      hold_batch_id: holdBatchId,
      field_key: f.field_key,
      field_label: labelForFieldKey(f.field_key),
      raised_by: caller.id,
      raised_by_role: caller.role,
      comment: f.comment.trim(),
      status: "open",
    }));

    const { error: insertErr } = await adminClient.from("compliance_flags").insert(flagRows);
    if (insertErr) throw new Error("Failed to save compliance flags: " + insertErr.message);

    // Remember where we were — the correction resumes review here instead of
    // always restarting at po_review (see submit-empanelment-correction).
    await adminClient.from("empanelment_applications").update({ status: "on_hold", hold_origin_status: app.status }).eq("id", application_id);

    const flagListHtml = flagRows.map((f) => `<li style="margin-bottom:10px;"><strong>${escapeHtml(f.field_label)}</strong><br/><span style="color:#6b7280;">${escapeHtml(f.comment)}</span></li>`).join("");
    const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";
    const html = wrapEmailBody(`
      <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear Sir / Ma'am,</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
        While reviewing the empanelment application submitted by <strong>${escapeHtml(orgName)}</strong>, we found the following item(s) need correction:
      </p>
      <ul style="margin:0 0 20px;padding-left:20px;font-size:13px;">${flagListHtml}</ul>
      <p style="margin:0 0 8px;">
        <a href="${siteUrl}/empanelment/correction" style="display:inline-block;background:#1a5fd4;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:14px;">Submit Correction &rarr;</a>
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#374151;line-height:1.7;">You will need your original 5-digit application code to access the correction form.</p>
    `);
    const emailSent = await sendResendEmail({ to: app.ba_email, subject: "Correction Needed — AFC India Limited Empanelment Application", html });

    await adminClient.from("empanelment_activity_log").insert({
      application_id,
      actor_id: caller.id,
      actor_role: caller.role,
      action: "hold_raised",
      comment: `${flagRows.length} item(s) flagged: ${flagRows.map((f) => f.field_label).join(", ")}`,
    });

    // Let the rest of the pipeline know review is paused — informational,
    // not action_required (the next step is the BA's, via their own
    // public correction form, not anything in-app for staff).
    const holdPayload = {
      title: "Compliance hold raised",
      sub_text: `${flagRows.length} item(s) flagged on ${orgName}'s application. Review is paused until the BA submits a correction.`,
      type: "info",
      link: `/empanelment/${application_id}`,
    };
    const holdRecipients = [app.sent_by, caller.role !== "project_officer" ? app.project_officer_id : null, caller.role !== "dgm" ? app.dgm_id : null];
    await Promise.all(holdRecipients.map((id) => notifyUser(adminClient, id, holdPayload)));

    return jsonRes(req, 200, { success: true, status: "on_hold", flags_count: flagRows.length, email_sent: emailSent });
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
