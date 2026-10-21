// supabase/functions/request-bp-invoice/index.ts
// JWT must be ON. Once the client has paid an AFC invoice, the project
// team asks the lead's Business Partner to raise their own invoice against
// that payment. First call creates the bp_invoices row (status
// 'requested'); later calls, while the BP still hasn't uploaded, are
// reminders (once every 24h). Emails the BP and drops an in-app alert on
// their Home, where they upload the invoice in whatever format they use
// (see submit_bp_invoice() in 20261008020000_monitoring_and_financials.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { escapeHtml, wrapEmailBody, sendResendEmail } from "../_shared/email.ts";
import { notifyUser } from "../_shared/notify.ts";

const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function inr(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const clientInvoiceId = body.client_invoice_id;
  if (typeof clientInvoiceId !== "string" || !clientInvoiceId) return jsonRes(req, 400, { error: "client_invoice_id is required." });
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
  let expectedAmount: number | null = null;
  if (body.expected_amount !== undefined && body.expected_amount !== null && body.expected_amount !== "") {
    expectedAmount = Number(body.expected_amount);
    if (!Number.isFinite(expectedAmount) || expectedAmount < 0) return jsonRes(req, 400, { error: "Expected amount must be a positive number." });
  }

  try {
    const { data: invoice, error: invErr } = await adminClient
      .from("client_invoices")
      .select("id, project_id, invoice_number, status")
      .eq("id", clientInvoiceId)
      .maybeSingle();
    if (invErr || !invoice) return jsonRes(req, 404, { error: "Client invoice not found." });

    const { data: project } = await adminClient
      .from("monitoring_projects")
      .select("id, lead_id")
      .eq("id", invoice.project_id)
      .maybeSingle();
    if (!project) return jsonRes(req, 404, { error: "Project not found." });

    const { data: lead } = await adminClient
      .from("leads")
      .select("id, title, client_name, assigned_ba_id, person_responsible_id, reviewer_id, recommending_authority_id")
      .eq("id", project.lead_id)
      .maybeSingle();
    if (!lead) return jsonRes(req, 404, { error: "Lead not found." });

    const authorized =
      ["md", "admin"].includes(caller.role) ||
      [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this project." });

    if (invoice.status !== "paid") return jsonRes(req, 400, { error: "Record the client's payment against this invoice first." });
    if (!lead.assigned_ba_id) return jsonRes(req, 400, { error: "This project has no linked Business Partner." });

    const { data: ba } = await adminClient.from("afc_users").select("email, full_name").eq("id", lead.assigned_ba_id).maybeSingle();

    const { data: existing } = await adminClient
      .from("bp_invoices")
      .select("id, status, requested_at, last_reminded_at, expected_amount")
      .eq("client_invoice_id", clientInvoiceId)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    let isReminder = false;
    let bpInvoiceId: string;
    let amountForMail: number | null = expectedAmount;

    if (existing) {
      if (existing.status !== "requested") return jsonRes(req, 400, { error: "The Business Partner has already submitted this invoice." });
      const lastSent = existing.last_reminded_at || existing.requested_at;
      const nextAllowedAt = new Date(lastSent).getTime() + REMINDER_COOLDOWN_MS;
      if (Date.now() < nextAllowedAt) {
        return jsonRes(req, 400, { error: `You can send a reminder once every 24 hours. Next reminder available at ${new Date(nextAllowedAt).toLocaleString("en-IN")}.` });
      }
      const patch: Record<string, unknown> = { last_reminded_at: nowIso };
      if (expectedAmount !== null) patch.expected_amount = expectedAmount;
      if (note) patch.request_note = note;
      const { error: updErr } = await adminClient.from("bp_invoices").update(patch).eq("id", existing.id);
      if (updErr) throw new Error(updErr.message);
      isReminder = true;
      bpInvoiceId = existing.id;
      if (amountForMail === null) amountForMail = existing.expected_amount;
    } else {
      const { data: inserted, error: insErr } = await adminClient
        .from("bp_invoices")
        .insert({
          project_id: invoice.project_id,
          client_invoice_id: clientInvoiceId,
          bp_id: lead.assigned_ba_id,
          expected_amount: expectedAmount,
          request_note: note,
          requested_by: caller.id,
          requested_at: nowIso,
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message || "Failed to create the invoice request.");
      bpInvoiceId = inserted.id;
    }

    await notifyUser(adminClient, lead.assigned_ba_id, {
      title: isReminder ? "Reminder: please upload your invoice" : "Please raise your invoice",
      sub_text: `${lead.title}${amountForMail !== null ? ` — ${inr(amountForMail)}` : ""}`,
      type: "action_required",
      link: "/home",
    });

    let emailSent = false;
    if (ba?.email) {
      const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";
      const html = wrapEmailBody(`
        <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear ${escapeHtml(ba.full_name || "Sir / Madam")},</p>
        <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
          ${isReminder ? "This is a reminder that AFC India Limited is still awaiting" : "AFC India Limited has received the client's payment and requests"}
          your invoice for <strong>${escapeHtml(lead.title)}</strong>${lead.client_name ? ` (${escapeHtml(lead.client_name)})` : ""}.
        </p>
        ${amountForMail !== null ? `<p style="margin:0 0 16px;font-size:14px;color:#374151;">Amount: <strong>${escapeHtml(inr(amountForMail))}</strong></p>` : ""}
        ${note ? `<p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">${escapeHtml(note)}</p>` : ""}
        <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.7;">
          Please sign in to the AFC portal and upload your invoice (in your own format) from your Home page.
        </p>
        <p style="margin:0;"><a href="${escapeHtml(siteUrl)}/login" style="display:inline-block;background:#1a5fd4;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">Upload Invoice</a></p>
      `);
      // Best-effort: the request row and the in-app alert already exist, so
      // a mail failure must not turn this into an error for the caller.
      try {
        emailSent = await sendResendEmail({
          to: ba.email,
          subject: `${isReminder ? "Reminder: " : ""}Invoice requested for "${lead.title}" — AFC India Limited`,
          html,
        });
      } catch (mailErr) {
        console.error("request-bp-invoice email failed:", (mailErr as Error).message);
      }
    }

    return jsonRes(req, 200, { success: true, bp_invoice_id: bpInvoiceId, is_reminder: isReminder, email_sent: emailSent });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
