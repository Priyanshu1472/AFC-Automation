// supabase/functions/proposal-emd-action/index.ts
// JWT must be ON. Everything that happens to the EMD once the client has
// responded to a proposal (proposal_emd_tracking):
//
//   Lead's team (Person Responsible / Reviewer / Recommending Authority,
//   or MD/Admin):
//     choose_track          awarded only — "refund" or "pbg" (converted to
//                           the Performance Bank Guarantee). A not-awarded
//                           proposal is always "refund" (set-proposal-outcome
//                           opens it). Can be switched until it's forwarded.
//     set_refund_received   refund: pending <-> received
//     save_pbg              pbg draft: PBG amount + remarks
//     forward               refund received / pbg draft -> pending_accounts
//                           (needs at least one proof file)
//   Accounts Committee:
//     verify                pending_accounts -> completed  (PIN + remark)
//     send_back             pending_accounts -> received / draft (remark)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { moduleOffResponse } from "../_shared/modules.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { notifyUsers } from "../_shared/notify.ts";
import {
  KIND_ACCOUNTS, KIND_EMD, isAccountsMember, isLeadTeam, loadProposalAndLead, notifyAccountsCommittee,
  teamIds, leadRef, proposalLink, clearPendingAlerts, logFinanceEvent, cleanRemark, rupees,
} from "../_shared/proposalFinance.ts";

const TEAM_ACTIONS = new Set(["choose_track", "set_refund_received", "save_pbg", "forward"]);
const ACCOUNTS_ACTIONS = new Set(["verify", "send_back"]);
const EDITABLE = new Set(["draft", "pending", "received"]);

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

  const proposalId = body.proposal_id;
  const action = body.action;
  if (typeof proposalId !== "string" || !proposalId) return jsonRes(req, 400, { error: "proposal_id is required." });
  if (typeof action !== "string" || !(TEAM_ACTIONS.has(action) || ACCOUNTS_ACTIONS.has(action))) {
    return jsonRes(req, 400, { error: "Invalid action." });
  }
  const remark = cleanRemark(body.remark);

  try {
    const ctx = await loadProposalAndLead(adminClient, proposalId);
    if (!ctx.ok) return jsonRes(req, ctx.status, { error: ctx.error });
    const { proposal, lead } = ctx;
    const link = proposalLink(lead);
    const ref = leadRef(lead);

    if (proposal.client_response === "pending") {
      return jsonRes(req, 400, { error: "Record the client's response before handling the EMD." });
    }

    if (TEAM_ACTIONS.has(action)) {
      const allowed = ["md", "admin"].includes(caller.role) || isLeadTeam(lead, caller.id);
      if (!allowed) return jsonRes(req, 403, { error: "Only this lead's Person Responsible, Reviewer or Recommending Authority can do this." });
    } else if (!(await isAccountsMember(adminClient, caller.id))) {
      return jsonRes(req, 403, { error: "Only an Accounts Committee member can do this." });
    }

    const { data: tracking } = await adminClient
      .from("proposal_emd_tracking")
      .select("*")
      .eq("proposal_id", proposalId)
      .maybeSingle();

    // ── choose_track ────────────────────────────────────────────────
    if (action === "choose_track") {
      const track = body.track;
      if (track !== "refund" && track !== "pbg") return jsonRes(req, 400, { error: "Choose EMD Refund or Converted to PBG." });
      if (track === "pbg" && proposal.client_response !== "awarded") {
        return jsonRes(req, 400, { error: "Only an awarded proposal can convert its EMD into a PBG." });
      }
      const { data: note } = await adminClient
        .from("fee_notes")
        .select("emd_amount, status")
        .eq("proposal_id", proposalId)
        .eq("status", "approved")
        .maybeSingle();
      const emd = note?.emd_amount != null ? Number(note.emd_amount) : 0;
      if (!(emd > 0)) return jsonRes(req, 400, { error: "This proposal's approved note has no EMD." });

      const fresh = {
        track,
        status: track === "pbg" ? "draft" : "pending",
        emd_amount: emd,
        pbg_amount: null, remarks: null, received_at: null, forwarded_at: null, forwarded_by: null,
        accounts_remark: null, completed_at: null, completed_by: null, last_reminder_at: null,
        updated_at: new Date().toISOString(),
      };

      if (tracking) {
        if (!EDITABLE.has(tracking.status)) return jsonRes(req, 400, { error: "This has already been forwarded to Accounts and can't be switched now." });
        if (tracking.track === track) return jsonRes(req, 200, { success: true });
        const { count } = await adminClient.from("proposal_finance_files").select("id", { count: "exact", head: true })
          .eq("proposal_id", proposalId).in("purpose", ["emd_refund", "pbg"]);
        if ((count || 0) > 0) return jsonRes(req, 400, { error: "Remove the uploaded proofs before switching." });
        const { error } = await adminClient.from("proposal_emd_tracking").update(fresh).eq("id", tracking.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await adminClient.from("proposal_emd_tracking").insert({ ...fresh, proposal_id: proposalId, created_by: caller.id });
        if (error) throw new Error(error.message);
      }
      await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "emd", action: track === "pbg" ? "chose_pbg" : "chose_refund", actor_id: caller.id });
      await clearPendingAlerts(adminClient, link, KIND_EMD);
      return jsonRes(req, 200, { success: true });
    }

    if (!tracking) return jsonRes(req, 400, { error: "Choose what happens to the EMD first." });

    // ── set_refund_received ─────────────────────────────────────────
    if (action === "set_refund_received") {
      if (tracking.track !== "refund") return jsonRes(req, 400, { error: "This EMD is being converted to a PBG, not refunded." });
      const received = body.received === true;
      const from = received ? "pending" : "received";
      if (tracking.status !== from) {
        return jsonRes(req, 400, { error: received ? "The refund is already marked received." : "The refund can only be set back to pending before it's forwarded." });
      }
      if (!received) {
        const { count } = await adminClient.from("proposal_finance_files").select("id", { count: "exact", head: true })
          .eq("proposal_id", proposalId).eq("purpose", "emd_refund");
        if ((count || 0) > 0) return jsonRes(req, 400, { error: "Remove the uploaded proofs before marking it pending again." });
      }
      const { data: upd, error } = await adminClient.from("proposal_emd_tracking")
        .update({
          status: received ? "received" : "pending",
          received_at: received ? new Date().toISOString() : null,
          // Re-arms the 14-day reminder from today when set back to pending.
          last_reminder_at: received ? tracking.last_reminder_at : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", tracking.id).eq("status", from).select("id");
      if (error) throw new Error(error.message);
      if (!upd?.length) return jsonRes(req, 409, { error: "This was just changed by someone else — refresh the page." });
      await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "emd", action: received ? "refund_received" : "refund_pending", actor_id: caller.id });
      if (received) await clearPendingAlerts(adminClient, link, KIND_EMD);
      return jsonRes(req, 200, { success: true });
    }

    // ── save_pbg ────────────────────────────────────────────────────
    if (action === "save_pbg") {
      if (tracking.track !== "pbg" || tracking.status !== "draft") return jsonRes(req, 400, { error: "The PBG details can't be edited now." });
      const amount = Number(body.pbg_amount);
      if (!Number.isFinite(amount) || amount <= 0) return jsonRes(req, 400, { error: "Enter the PBG amount." });
      const { error } = await adminClient.from("proposal_emd_tracking")
        .update({ pbg_amount: Math.round(amount * 100) / 100, remarks: remark || null, updated_at: new Date().toISOString() })
        .eq("id", tracking.id).eq("status", "draft");
      if (error) throw new Error(error.message);
      return jsonRes(req, 200, { success: true });
    }

    // ── forward ─────────────────────────────────────────────────────
    if (action === "forward") {
      const isRefund = tracking.track === "refund";
      const from = isRefund ? "received" : "draft";
      if (tracking.status !== from) {
        return jsonRes(req, 400, { error: isRefund ? "Mark the refund as Received before forwarding." : "This can't be forwarded right now." });
      }
      if (!isRefund && !(Number(tracking.pbg_amount) > 0)) return jsonRes(req, 400, { error: "Enter the PBG amount and create the PBG note first." });
      const purpose = isRefund ? "emd_refund" : "pbg";
      const { count } = await adminClient.from("proposal_finance_files").select("id", { count: "exact", head: true })
        .eq("proposal_id", proposalId).eq("purpose", purpose);
      if ((count || 0) === 0) return jsonRes(req, 400, { error: "Upload at least one proof before forwarding." });

      const { data: upd, error } = await adminClient.from("proposal_emd_tracking")
        .update({
          status: "pending_accounts",
          remarks: remark || tracking.remarks || null,
          forwarded_at: new Date().toISOString(),
          forwarded_by: caller.id,
          accounts_remark: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tracking.id).eq("status", from).select("id");
      if (error) throw new Error(error.message);
      if (!upd?.length) return jsonRes(req, 409, { error: "This was just changed by someone else — refresh the page." });

      await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "emd", action: "forwarded_to_accounts", remark: remark || tracking.remarks, actor_id: caller.id });
      await clearPendingAlerts(adminClient, link, KIND_EMD);
      await notifyAccountsCommittee(adminClient, isRefund
        ? {
          title: "EMD refund awaiting verification",
          sub_text: `${ref}: the EMD of ${rupees(tracking.emd_amount)} has been received back. Check the proofs and verify the refund.`,
          type: "action_required",
          link,
        }
        : {
          title: "PBG note awaiting Accounts",
          sub_text: `${ref}: the EMD of ${rupees(tracking.emd_amount)} is being converted to a PBG of ${rupees(tracking.pbg_amount)} (remaining ${rupees(Number(tracking.pbg_amount) - Number(tracking.emd_amount))}). Check the PBG note and process it.`,
          type: "action_required",
          link,
        });
      return jsonRes(req, 200, { success: true });
    }

    // ── Accounts: verify / send_back ───────────────────────────────
    if (tracking.status !== "pending_accounts") return jsonRes(req, 400, { error: "This isn't waiting for Accounts." });
    const isRefund = tracking.track === "refund";

    if (action === "verify") {
      const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
      if (pinErr) return jsonRes(req, 400, { error: pinErr });
      const { data: upd, error } = await adminClient.from("proposal_emd_tracking")
        .update({ status: "completed", accounts_remark: remark || null, completed_at: new Date().toISOString(), completed_by: caller.id, updated_at: new Date().toISOString() })
        .eq("id", tracking.id).eq("status", "pending_accounts").select("id");
      if (error) throw new Error(error.message);
      if (!upd?.length) return jsonRes(req, 409, { error: "Someone else just acted on this — refresh the page." });
      await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "emd", action: isRefund ? "refund_verified" : "pbg_processed", remark, actor_id: caller.id });
      await clearPendingAlerts(adminClient, link, KIND_ACCOUNTS);
      await notifyUsers(adminClient, teamIds(lead), {
        title: isRefund ? "EMD refund verified by Accounts" : "PBG processed by Accounts",
        sub_text: `${ref}: ${isRefund ? `Accounts verified the EMD refund of ${rupees(tracking.emd_amount)}` : `Accounts processed the PBG of ${rupees(tracking.pbg_amount)}`}.${remark ? ` "${remark}"` : ""}`,
        type: "info",
        link,
      });
      return jsonRes(req, 200, { success: true });
    }

    // send_back
    if (!remark) return jsonRes(req, 400, { error: "Add a remark saying what needs fixing." });
    const backTo = isRefund ? "received" : "draft";
    const { data: upd, error } = await adminClient.from("proposal_emd_tracking")
      .update({ status: backTo, accounts_remark: remark, forwarded_at: null, forwarded_by: null, updated_at: new Date().toISOString() })
      .eq("id", tracking.id).eq("status", "pending_accounts").select("id");
    if (error) throw new Error(error.message);
    if (!upd?.length) return jsonRes(req, 409, { error: "Someone else just acted on this — refresh the page." });
    await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "emd", action: "returned_by_accounts", remark, actor_id: caller.id });
    await clearPendingAlerts(adminClient, link, KIND_ACCOUNTS);
    await notifyUsers(adminClient, teamIds(lead), {
      title: isRefund ? "EMD refund sent back by Accounts" : "PBG note sent back by Accounts",
      sub_text: `${ref}: Accounts sent it back — "${remark}"`,
      type: "action_required",
      link,
      kind: KIND_EMD,
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
