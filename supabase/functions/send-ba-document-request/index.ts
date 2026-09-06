// supabase/functions/send-ba-document-request/index.ts
// JWT must be ON. Emails the lead's linked BA the FULL current itemized
// list every time it's called — first call is "Send to BA", every call
// after is effectively a reminder (the "Send Reminder" button on the panel
// is always visible, not gated on unsent items existing). Marks any
// still-unsent rows' sent_at on the way, but never refuses to send just
// because everything was already sent once. BA-facing response UI is out
// of scope for now; this is a one-way notice.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { escapeHtml, wrapEmailBody, sendResendEmail } from "../_shared/email.ts";

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

  const proposalId = body.proposal_id;
  if (typeof proposalId !== "string" || !proposalId) return jsonRes(req, 400, { error: "proposal_id is required." });

  try {
    const { data: proposal, error: propErr } = await adminClient
      .from("proposal_preparations")
      .select("id, lead_id, locked")
      .eq("id", proposalId)
      .maybeSingle();
    if (propErr || !proposal) return jsonRes(req, 404, { error: "Proposal not found." });

    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, title, submission_deadline, assigned_ba_id, person_responsible_id, reviewer_id, approval_authority_id")
      .eq("id", proposal.lead_id)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    // Managing/sending the BA document list is the lead's own team's job
    // (Person Responsible, Reviewer, Approval Authority) — MD/Admin can
    // view but not act. Mirrors the client gate in
    // ProposalPreparationPage.jsx (canManageDocs).
    const authorized = [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "Only the lead's Person Responsible, Reviewer, or Approval Authority can send this to the BA." });

    const pastDeadline = !!lead.submission_deadline && new Date(lead.submission_deadline) < new Date();
    if (proposal.locked || pastDeadline) {
      return jsonRes(req, 400, { error: "This proposal is locked and can no longer be edited." });
    }

    if (!lead.assigned_ba_id) return jsonRes(req, 400, { error: "This lead has no linked Business Associate to send a request to." });

    const { data: ba } = await adminClient.from("afc_users").select("email").eq("id", lead.assigned_ba_id).maybeSingle();
    if (!ba?.email) return jsonRes(req, 400, { error: "The linked Business Associate has no email on file." });

    const { data: proposalRow, error: prepErr } = await adminClient
      .from("proposal_preparations")
      .select("ba_send_count, ba_last_sent_at")
      .eq("id", proposalId)
      .maybeSingle();
    if (prepErr || !proposalRow) throw new Error(prepErr?.message || "Proposal not found.");
    const isFirstSend = (proposalRow.ba_send_count || 0) === 0;

    // Cap reminders to once every 24h — mirrors the disabled state the UI
    // already shows, enforced here too so it can't be bypassed by calling
    // this function directly.
    const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    if (proposalRow.ba_last_sent_at) {
      const nextAllowedAt = new Date(proposalRow.ba_last_sent_at).getTime() + REMINDER_COOLDOWN_MS;
      if (Date.now() < nextAllowedAt) {
        return jsonRes(req, 400, {
          error: `You can send a reminder once every 24 hours. Next reminder available at ${new Date(nextAllowedAt).toLocaleString("en-IN")}.`,
        });
      }
    }

    const { data: items, error: itemsErr } = await adminClient
      .from("proposal_document_requests")
      .select("id, item_name, justification, sent_at")
      .eq("proposal_id", proposalId)
      .order("created_at");
    if (itemsErr) throw new Error(itemsErr.message);
    if (!items || items.length === 0) return jsonRes(req, 400, { error: "There are no items to send yet." });

    const nowIso = new Date().toISOString();
    const { error: updErr } = await adminClient
      .from("proposal_document_requests")
      .update({ sent_at: nowIso })
      .eq("proposal_id", proposalId)
      .is("sent_at", null);
    if (updErr) throw new Error(updErr.message);

    const { error: countErr } = await adminClient
      .from("proposal_preparations")
      .update({ ba_send_count: (proposalRow.ba_send_count || 0) + 1, ba_last_sent_at: nowIso })
      .eq("id", proposalId);
    if (countErr) throw new Error(countErr.message);

    const itemsHtml = items.map((it) => `
      <li style="margin-bottom:12px;">
        <strong>${escapeHtml(it.item_name)}</strong>
        ${it.justification ? `<br/><span style="color:#6b7280;font-size:13px;">${escapeHtml(it.justification)}</span>` : ""}
      </li>
    `).join("");

    const html = wrapEmailBody(`
      <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear Sir / Ma'am,</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
        ${isFirstSend ? "AFC India Limited requires" : "This is a reminder that AFC India Limited still requires"}
        the following from you for the proposal being prepared for
        <strong>${escapeHtml(lead.title)}</strong>:
      </p>
      <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#374151;">${itemsHtml}</ul>
      <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;">Kindly share these at your earliest convenience.</p>
    `);

    const emailSent = await sendResendEmail({
      to: ba.email,
      subject: `${isFirstSend ? "Documents Required" : "Reminder: Documents Required"} for "${lead.title}" — AFC India Limited`,
      html,
    });

    return jsonRes(req, 200, { success: true, email_sent: emailSent, items_sent: items.length, is_first_send: isFirstSend });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
