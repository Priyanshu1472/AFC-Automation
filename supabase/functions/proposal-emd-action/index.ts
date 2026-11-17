// supabase/functions/proposal-emd-action/index.ts
// JWT must be ON. Everything that happens to the EMD once the client has
// responded to a proposal (proposal_emd_tracking):
//
//   Lead's team (Person Responsible / Reviewer / Recommending Authority, an
//   additional Person Responsible, or MD/Admin):
//     choose_track          "refund", "pbg" (adjusted towards the
//                           Performance Bank Guarantee — awarded only) or
//                           "on_completion" (awarded only — the client
//                           returns the EMD when the project completes; no
//                           reminders). A not-awarded proposal is always
//                           "refund" (set-proposal-outcome opens it).
//                           Switchable until it's forwarded to Accounts /
//                           the PBG Note leaves draft — e.g. On Completion
//                           -> EMD Refund when the client returns the EMD
//                           mid-project. Switching away from a refund that
//                           already has proofs removes those proofs.
//     set_refund_received   refund: pending <-> received. Going back to
//                           pending removes the uploaded refund proofs (they
//                           get uploaded again once it's received).
//     forward               refund received -> pending_accounts
//                           (needs at least one proof file and a remark).
//                           A "pbg" EMD is processed through the PBG Note
//                           instead (proposal-pbg-note).
//   Accounts Committee:
//     verify                pending_accounts -> completed  (PIN). The team
//                           and the MD are told.
//     request_clarification pending_accounts -> received (remark) — goes
//                           back to the PR / Reviewer / RA. ("send_back" is
//                           still accepted as an alias.)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { moduleOffResponse } from "../_shared/modules.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { addProposalChatParticipants } from "../_shared/proposalChat.ts";
import {
  KIND_ACCOUNTS, KIND_EMD, isAccountsMember, loadProposalAndLead, notifyAccountsCommittee, getAccountsMemberIds,
  leadRef, proposalLink, clearPendingAlerts, logFinanceEvent, cleanRemark, rupees,
  proposalTeamIds, getMdIds, deleteFinanceFiles, countFinanceFiles,
} from "../_shared/proposalFinance.ts";

const TEAM_ACTIONS = new Set(["choose_track", "set_refund_received", "forward"]);
const ACCOUNTS_ACTIONS = new Set(["verify", "request_clarification", "send_back"]);
const EDITABLE = new Set(["draft", "pending", "received", "awaiting_completion"]);
const TRACKS = new Set(["refund", "pbg", "on_completion"]);
const START_STATUS: Record<string, string> = { refund: "pending", pbg: "draft", on_completion: "awaiting_completion" };
const TRACK_LABEL: Record<string, string> = { refund: "EMD Refund", pbg: "Converted to PBG", on_completion: "On Completion" };

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

    const team = await proposalTeamIds(adminClient, proposalId, lead);
    const teamExceptCaller = team.filter((id) => id !== caller.id);

    if (TEAM_ACTIONS.has(action)) {
      const allowed = ["md", "admin"].includes(caller.role) || team.includes(caller.id);
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
      if (typeof track !== "string" || !TRACKS.has(track)) return jsonRes(req, 400, { error: "Choose EMD Refund, Converted to PBG or On Completion." });
      if (track !== "refund" && proposal.client_response !== "awarded") {
        return jsonRes(req, 400, { error: "Only an awarded proposal can convert its EMD into a PBG or hold it until completion." });
      }
      const { data: note } = await adminClient
        .from("fee_notes")
        .select("emd_amount, status")
        .eq("proposal_id", proposalId)
        .eq("status", "approved")
        .maybeSingle();
      const emd = note?.emd_amount != null ? Number(note.emd_amount) : 0;
      if (!(emd > 0)) return jsonRes(req, 400, { error: "This proposal's approved note has no EMD." });

      if (tracking) {
        if (!EDITABLE.has(tracking.status)) return jsonRes(req, 400, { error: "This has already been forwarded to Accounts and can't be switched now." });
        if (tracking.track === track) return jsonRes(req, 200, { success: true });
        if (tracking.track === "pbg") {
          const { data: pbgNote } = await adminClient.from("proposal_pbg_notes").select("status").eq("proposal_id", proposalId).maybeSingle();
          if (pbgNote && pbgNote.status !== "draft") {
            return jsonRes(req, 400, { error: "The PBG Note has already been forwarded with this EMD adjusted — it can't be switched now." });
          }
        }
      }

      const fresh = {
        track,
        status: START_STATUS[track],
        emd_amount: emd,
        pbg_amount: null, remarks: null, received_at: null, forwarded_at: null, forwarded_by: null,
        accounts_remark: null, completed_at: null, completed_by: null,
        // A refund starts its 14-day reminder clock from today.
        last_reminder_at: track === "refund" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };

      if (tracking) {
        if (tracking.track === "refund") await deleteFinanceFiles(adminClient, proposalId, "emd_refund");
        const { data: upd, error } = await adminClient.from("proposal_emd_tracking").update(fresh)
          .eq("id", tracking.id).eq("status", tracking.status).select("id");
        if (error) throw new Error(error.message);
        if (!upd?.length) return jsonRes(req, 409, { error: "This was just changed by someone else — refresh the page." });
      } else {
        const { error } = await adminClient.from("proposal_emd_tracking").insert({ ...fresh, proposal_id: proposalId, created_by: caller.id });
        if (error) throw new Error(error.message);
      }

      // Keep a draft PBG Note's adjusted EMD in step with the track.
      await adminClient.from("proposal_pbg_notes")
        .update({ emd_amount: emd, emd_adjusted: 0, updated_at: new Date().toISOString() })
        .eq("proposal_id", proposalId).eq("status", "draft");
      if (track === "pbg") {
        const { data: pbgNote } = await adminClient.from("proposal_pbg_notes").select("id, pbg_amount").eq("proposal_id", proposalId).eq("status", "draft").maybeSingle();
        if (pbgNote) {
          await adminClient.from("proposal_pbg_notes")
            .update({ emd_adjusted: Math.min(emd, Number(pbgNote.pbg_amount) || 0) })
            .eq("id", pbgNote.id);
        }
      }

      await logFinanceEvent(adminClient, {
        proposal_id: proposalId, scope: "emd",
        action: track === "pbg" ? "chose_pbg" : track === "on_completion" ? "chose_on_completion" : "chose_refund",
        actor_id: caller.id,
      });
      await clearPendingAlerts(adminClient, link, KIND_EMD);
      await notifyUsers(adminClient, teamExceptCaller, {
        title: `EMD: ${TRACK_LABEL[track]}`,
        sub_text: track === "on_completion"
          ? `${ref}: the EMD of ${rupees(emd)} will be refunded on completion of the project. No reminders will be sent until then.`
          : track === "pbg"
          ? `${ref}: the EMD of ${rupees(emd)} will be converted to the PBG. Prepare the PBG Note.`
          : `${ref}: the EMD of ${rupees(emd)} is to be refunded by the client. Mark it Received and upload the proof once it's back.`,
        type: track === "on_completion" ? "info" : "action_required",
        link,
        kind: KIND_EMD,
      });
      return jsonRes(req, 200, { success: true });
    }

    if (!tracking) return jsonRes(req, 400, { error: "Choose what happens to the EMD first." });

    // ── set_refund_received ─────────────────────────────────────────
    if (action === "set_refund_received") {
      if (tracking.track !== "refund") return jsonRes(req, 400, { error: "This EMD isn't being refunded." });
      const received = body.received === true;
      const from = received ? "pending" : "received";
      if (tracking.status !== from) {
        return jsonRes(req, 400, { error: received ? "The refund is already marked received." : "The refund can only be set back to pending before it's forwarded." });
      }
      // Back to pending: the proofs belonged to the "received" state, so
      // they go too — they're uploaded again once it's received.
      if (!received) await deleteFinanceFiles(adminClient, proposalId, "emd_refund");
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

    // ── forward ─────────────────────────────────────────────────────
    if (action === "forward") {
      if (tracking.track !== "refund") {
        return jsonRes(req, 400, { error: tracking.track === "pbg" ? "A converted EMD goes to Accounts through the PBG Note." : "Switch to EMD Refund once the client returns the EMD." });
      }
      if (tracking.status !== "received") return jsonRes(req, 400, { error: "Mark the refund as Received before forwarding." });
      if ((await countFinanceFiles(adminClient, proposalId, "emd_refund")) === 0) return jsonRes(req, 400, { error: "Upload at least one proof before forwarding." });
      if (!remark) return jsonRes(req, 400, { error: "Add a remark before forwarding." });

      const { data: upd, error } = await adminClient.from("proposal_emd_tracking")
        .update({
          status: "pending_accounts",
          remarks: remark,
          forwarded_at: new Date().toISOString(),
          forwarded_by: caller.id,
          accounts_remark: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tracking.id).eq("status", "received").select("id");
      if (error) throw new Error(error.message);
      if (!upd?.length) return jsonRes(req, 409, { error: "This was just changed by someone else — refresh the page." });

      await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "emd", action: "forwarded_to_accounts", remark, actor_id: caller.id });
      await clearPendingAlerts(adminClient, link, KIND_EMD);
      await addProposalChatParticipants(adminClient, proposalId, await getAccountsMemberIds(adminClient), "accounts", caller.id);
      await notifyAccountsCommittee(adminClient, {
        title: "EMD refund awaiting verification",
        sub_text: `${ref}: the EMD of ${rupees(tracking.emd_amount)} has been received back. Check the proofs and verify the refund.`,
        type: "action_required",
        link,
      });
      await notifyUsers(adminClient, teamExceptCaller, {
        title: "EMD refund forwarded to Accounts",
        sub_text: `${ref}: the EMD refund of ${rupees(tracking.emd_amount)} was forwarded to Accounts for verification.`,
        type: "info",
        link,
      });
      return jsonRes(req, 200, { success: true });
    }

    // ── Accounts: verify / request_clarification ───────────────────
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
      // The lead's team and every MD hear about it.
      await notifyUsers(adminClient, [...team, ...(await getMdIds(adminClient))], {
        title: isRefund ? "EMD refund verified by Accounts" : "PBG processed by Accounts",
        sub_text: `${ref}: ${isRefund ? `Accounts verified the EMD refund of ${rupees(tracking.emd_amount)}` : `Accounts processed the PBG of ${rupees(tracking.pbg_amount)}`}.${remark ? ` "${remark}"` : ""}`,
        type: "info",
        link,
      });
      return jsonRes(req, 200, { success: true });
    }

    // request_clarification (send_back)
    if (!remark) return jsonRes(req, 400, { error: "Say what needs clarifying." });
    const backTo = isRefund ? "received" : "draft";
    const { data: upd, error } = await adminClient.from("proposal_emd_tracking")
      .update({ status: backTo, accounts_remark: remark, forwarded_at: null, forwarded_by: null, updated_at: new Date().toISOString() })
      .eq("id", tracking.id).eq("status", "pending_accounts").select("id");
    if (error) throw new Error(error.message);
    if (!upd?.length) return jsonRes(req, 409, { error: "Someone else just acted on this — refresh the page." });
    await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "emd", action: "clarification_requested", remark, actor_id: caller.id });
    await clearPendingAlerts(adminClient, link, KIND_ACCOUNTS);
    await notifyUsers(adminClient, team, {
      title: "Clarification requested by Accounts",
      sub_text: `${ref}: Accounts needs a clarification on the ${isRefund ? "EMD refund" : "PBG"} — "${remark}"`,
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
