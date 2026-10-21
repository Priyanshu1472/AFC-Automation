// supabase/functions/decide-client-invoice/index.ts
// JWT must be ON. The CFO's decision on a client invoice (pending_cfo →
// raised/rejected), gated by the same 4-digit action PIN as every other
// decision edge function (verifyActionPin). Approval stamps
// cfo_decided_by/at — the signature printed on the invoice PDF
// (monitoring-pdf → buildClientInvoicePdf) comes live from whichever
// account that id names, same pattern as the MD's signature on fee notes.
// Rejection requires a remark and sends the invoice to 'rejected'; the team
// fixes it and resubmits via save_client_invoice, which resets it to
// pending_cfo (see 20261026000000_cfo_invoice_approval.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { notifyUsers } from "../_shared/notify.ts";

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;
  if (caller.role !== "cfo") return jsonRes(req, 403, { error: "Only the CFO can decide on this invoice." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const invoiceId = body.invoice_id;
  const decision = body.decision;
  const remark = typeof body.remark === "string" ? body.remark.trim() : null;
  if (typeof invoiceId !== "string" || !invoiceId) return jsonRes(req, 400, { error: "invoice_id is required." });
  if (decision !== "approved" && decision !== "rejected") return jsonRes(req, 400, { error: "Invalid decision." });
  if (decision === "rejected" && !remark) return jsonRes(req, 400, { error: "A remark is required when rejecting an invoice." });

  const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
  if (pinErr) return jsonRes(req, 400, { error: pinErr });

  try {
    const { data: inv, error: fetchErr } = await adminClient
      .from("client_invoices")
      .select("id, project_id, invoice_number, status")
      .eq("id", invoiceId)
      .maybeSingle();
    if (fetchErr || !inv) return jsonRes(req, 404, { error: "Invoice not found." });
    if (inv.status !== "pending_cfo") {
      return jsonRes(req, 400, { error: `This invoice is "${inv.status}", not "pending_cfo". It may have just been updated by someone else — refresh and try again.` });
    }

    const updates = decision === "approved"
      ? { status: "raised", cfo_decided_by: caller.id, cfo_decided_at: new Date().toISOString(), cfo_remark: remark }
      : { status: "rejected", cfo_decided_by: caller.id, cfo_decided_at: new Date().toISOString(), cfo_remark: remark };

    const { error: updErr } = await adminClient.from("client_invoices").update(updates).eq("id", invoiceId).eq("status", "pending_cfo");
    if (updErr) throw new Error(updErr.message);

    const { data: teamIds } = await adminClient.rpc("monitoring_team_ids", { p_project_id: inv.project_id });

    await notifyUsers(adminClient, (teamIds || []) as string[], {
      title: decision === "approved" ? `Invoice approved — ${inv.invoice_number}` : `Invoice sent back — ${inv.invoice_number}`,
      sub_text: decision === "approved"
        ? `The CFO approved and signed invoice ${inv.invoice_number}.`
        : `The CFO sent invoice ${inv.invoice_number} back: ${remark}`,
      type: decision === "approved" ? "info" : "action_required",
      link: `/monitoring/${inv.project_id}?tab=invoices`,
    });

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
