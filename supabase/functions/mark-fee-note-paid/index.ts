// supabase/functions/mark-fee-note-paid/index.ts
// JWT must be ON. An Accounts Committee member — or the lead's Person
// Responsible / an additional Person Responsible, when the payment went
// through them — records that the payment on an MD-approved Bid Payment
// Requisition Note has been made — after
// checking the note carries every required signature. PIN-gated, once
// only. Works regardless of the proposal's lock state: paying the EMD /
// fees can happen after the bid is submitted.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { moduleOffResponse } from "../_shared/modules.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { notifyUsers } from "../_shared/notify.ts";
import {
  KIND_ACCOUNTS, KIND_FEE_PROOF, isAccountsMember, loadProposalAndLead, teamIds, leadRef, proposalLink,
  getAdditionalResponsibleIds, notifyAccountsCommittee,
  clearPendingAlerts, logFinanceEvent, cleanRemark,
} from "../_shared/proposalFinance.ts";

const NOTE_LABEL = "Bid Payment Requisition Note";

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  const moduleOff = await moduleOffResponse(req, "proposals");
  if (moduleOff) return moduleOff;
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

  const feeNoteId = body.fee_note_id;
  if (typeof feeNoteId !== "string" || !feeNoteId) return jsonRes(req, 400, { error: "fee_note_id is required." });
  const reference = cleanRemark(body.payment_reference, 200);
  const remark = cleanRemark(body.remark);

  try {
    const { data: note, error: noteErr } = await adminClient
      .from("fee_notes")
      .select("id, proposal_id, status, payment_status")
      .eq("id", feeNoteId)
      .maybeSingle();
    if (noteErr || !note) return jsonRes(req, 404, { error: "Note not found." });
    if (note.status !== "approved") return jsonRes(req, 400, { error: "This note hasn't been approved by the MD yet." });
    if (note.payment_status === "paid") return jsonRes(req, 400, { error: "The payment on this note has already been recorded." });

    const ctx = await loadProposalAndLead(adminClient, note.proposal_id);
    if (!ctx.ok) return jsonRes(req, ctx.status, { error: ctx.error });
    const { lead } = ctx;

    const isAccounts = await isAccountsMember(adminClient, caller.id);
    const isPr = caller.id === lead.person_responsible_id ||
      (await getAdditionalResponsibleIds(adminClient, note.proposal_id)).includes(caller.id);
    if (!isAccounts && !isPr) {
      return jsonRes(req, 403, { error: "Only an Accounts Committee member or the Person Responsible can record this payment." });
    }

    const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
    if (pinErr) return jsonRes(req, 400, { error: pinErr });

    const { data: updated, error: updErr } = await adminClient
      .from("fee_notes")
      .update({
        payment_status: "paid",
        payment_done_at: new Date().toISOString(),
        payment_done_by: caller.id,
        payment_reference: reference || null,
        payment_remark: remark || null,
      })
      .eq("id", feeNoteId)
      .eq("status", "approved")
      .eq("payment_status", "pending")
      .select("id");
    if (updErr) throw new Error(updErr.message);
    if (!updated?.length) return jsonRes(req, 409, { error: "Someone else just recorded this payment — refresh the page." });

    await logFinanceEvent(adminClient, {
      proposal_id: note.proposal_id, scope: "fee_payment", action: "payment_done",
      remark: [reference && `Ref: ${reference}`, remark].filter(Boolean).join(" — "), actor_id: caller.id,
    });

    const link = proposalLink(lead);
    await clearPendingAlerts(adminClient, link, KIND_ACCOUNTS);
    await clearPendingAlerts(adminClient, link, KIND_FEE_PROOF);
    const byWhom = isAccounts ? "Accounts has" : "the Person Responsible has";
    const payload = {
      title: isAccounts ? "Payment made by Accounts" : "Payment marked done",
      sub_text: `${leadRef(lead)}: ${byWhom} recorded the payment on the ${NOTE_LABEL}.${reference ? ` Ref: ${reference}.` : ""}`,
      type: "info",
      link,
    };
    await notifyUsers(adminClient, teamIds(lead).filter((id) => id !== caller.id), payload);
    if (!isAccounts) await notifyAccountsCommittee(adminClient, { ...payload, kind: "proposal_fee_paid_info" });

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
