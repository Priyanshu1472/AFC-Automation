// supabase/functions/advance-fee-note-stage/index.ts
// JWT must be ON. Moves the Bid Payment Requisition Note through the Person
// Responsible -> Recommending Authority -> MD sign-off chain
// (mirrors advance-lead-stage / advance-empanelment-stage's shape). The
// MD's own final approve/reject stays in decide-fee-note-md — this function
// only covers the first two hops:
//
//   pr_forward draft -> pending_recommending_authority   (PIN required — signs as Person Responsible)
//   ra_forward pending_recommending_authority -> pending_md (PIN required — signs as Recommending Authority)
//   ra_send_back pending_recommending_authority -> draft  (remark required, no PIN —
//                mirrors ra_decline's existing exception on the lead itself:
//                sending a note back to its preparer isn't itself a decision)
//
// Deliberately NO md/admin override on either hop — pr_signed_by/
// ra_signed_by get stamped into the printed PDF under the "Person
// Responsible"/"Recommending Authority" signature columns, so whoever
// forwards must actually BE this lead's named Person Responsible/Reviewer/
// Recommending Authority, never an admin acting on their behalf, or the
// note ends up signed by the wrong office (e.g. the MD's name printed under
// "Recommending Authority" because they used a bypass to forward it
// themselves).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { notifyRole, notifyUsers, emailRole } from "../_shared/notify.ts";
import { wrapEmailBody, escapeHtml } from "../_shared/email.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const NOTE_LABEL = "Bid Payment Requisition Note";
const ACTIONS = new Set(["pr_forward", "ra_forward", "ra_send_back"]);
const FEE_KEYS = ["emd", "tender_fee", "processing_fee"] as const;
// Payee details ("in favour of" / "payable at") are only meaningful for an
// actual instrument, not a plain online transfer.
const NEEDS_PAYEE = new Set(["demand_draft", "bank_guarantee", "bankers_cheque", "fixed_deposit_receipt"]);

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

  const feeNoteId = body.fee_note_id;
  const action = body.action;
  const remark = typeof body.remark === "string" ? body.remark.trim().slice(0, 2000) : "";
  if (typeof feeNoteId !== "string" || !feeNoteId) return jsonRes(req, 400, { error: "fee_note_id is required." });
  if (typeof action !== "string" || !ACTIONS.has(action)) return jsonRes(req, 400, { error: "Invalid action." });
  if (action === "ra_send_back" && !remark) return jsonRes(req, 400, { error: "A remark is required when sending a note back." });

  try {
    const { data: note, error: noteErr } = await adminClient
      .from("fee_notes")
      .select(`
        id, proposal_id, justification, status,
        emd_amount, emd_payment_mode, emd_dd_in_favour_of, emd_dd_payable_at,
        tender_fee_amount, tender_fee_payment_mode, tender_fee_dd_in_favour_of, tender_fee_dd_payable_at,
        processing_fee_amount, processing_fee_payment_mode, processing_fee_dd_in_favour_of, processing_fee_dd_payable_at
      `)
      .eq("id", feeNoteId)
      .maybeSingle();
    if (noteErr || !note) return jsonRes(req, 404, { error: "Fee note not found." });

    const { data: proposal, error: propErr } = await adminClient
      .from("proposal_preparations")
      .select("id, lead_id, locked")
      .eq("id", note.proposal_id)
      .maybeSingle();
    if (propErr || !proposal) return jsonRes(req, 404, { error: "Proposal not found." });

    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, title, submission_deadline, person_responsible_id, reviewer_id, recommending_authority_id")
      .eq("id", proposal.lead_id)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    const pastDeadline = !!lead.submission_deadline && new Date(lead.submission_deadline) < new Date();
    if (proposal.locked || pastDeadline) {
      return jsonRes(req, 400, { error: "This proposal is locked and can no longer be edited." });
    }

    const noteLabel = NOTE_LABEL;

    if (action === "pr_forward") {
      if (note.status !== "draft") {
        return jsonRes(req, 400, { error: `This note is "${note.status}", not "draft". It may have just been updated by someone else — refresh and try again.` });
      }
      const authorized = [lead.person_responsible_id, lead.reviewer_id].includes(caller.id);
      if (!authorized) return jsonRes(req, 403, { error: "Only this lead's Person Responsible or Reviewer can forward this note." });
      const activeKeys = FEE_KEYS.filter((k) => note[`${k}_amount`] != null && Number(note[`${k}_amount`]) > 0);
      if (!activeKeys.length || !note.justification) {
        return jsonRes(req, 400, { error: "Fill in at least one fee amount and the justification before forwarding." });
      }
      for (const key of activeKeys) {
        const mode = note[`${key}_payment_mode`];
        if (!mode) return jsonRes(req, 400, { error: "Select a payment mode for every fee before forwarding." });
        if (NEEDS_PAYEE.has(mode) && (!note[`${key}_dd_in_favour_of`] || !note[`${key}_dd_payable_at`])) {
          return jsonRes(req, 400, { error: 'Fill in "in favour of" and "payable at" for every instrument-based fee before forwarding.' });
        }
      }

      const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
      if (pinErr) return jsonRes(req, 400, { error: pinErr });

      const { error: updErr } = await adminClient
        .from("fee_notes")
        .update({ status: "pending_recommending_authority", pr_signed_by: caller.id, pr_signed_at: new Date().toISOString() })
        .eq("id", feeNoteId)
        .eq("status", "draft");
      if (updErr) throw new Error(updErr.message);

      await adminClient.from("fee_note_events").insert({ fee_note_id: feeNoteId, actor_id: caller.id, actor_name: caller.email, action: "forwarded_to_ra", remark: null });

      if (lead.recommending_authority_id) {
        await notifyUsers(adminClient, [lead.recommending_authority_id], {
          title: `${noteLabel} awaiting your approval`,
          sub_text: `${noteLabel} for "${lead.title}" has been forwarded to you.`,
          type: "action_required",
          link: "/leads",
        });
      }

      return jsonRes(req, 200, { success: true });
    }

    // ra_forward / ra_send_back
    if (note.status !== "pending_recommending_authority") {
      return jsonRes(req, 400, { error: `This fee note is "${note.status}", not "pending_recommending_authority". It may have just been updated by someone else — refresh and try again.` });
    }
    const authorized = caller.id === lead.recommending_authority_id;
    if (!authorized) return jsonRes(req, 403, { error: "Only this lead's Recommending Authority can act at this stage." });

    if (action === "ra_forward") {
      const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
      if (pinErr) return jsonRes(req, 400, { error: pinErr });

      const { error: updErr } = await adminClient
        .from("fee_notes")
        .update({ status: "pending_md", ra_signed_by: caller.id, ra_signed_at: new Date().toISOString() })
        .eq("id", feeNoteId)
        .eq("status", "pending_recommending_authority");
      if (updErr) throw new Error(updErr.message);

      await adminClient.from("fee_note_events").insert({ fee_note_id: feeNoteId, actor_id: caller.id, actor_name: caller.email, action: "forwarded_to_md", remark: null });

      await notifyRole(adminClient, "md", {
        title: `${noteLabel} awaiting your approval`,
        sub_text: `${noteLabel} for "${lead.title}" needs your approval.`,
        type: "action_required",
        link: "/leads",
      });
      await emailRole(adminClient, "md", {
        subject: "Fee Note Awaiting Your Approval — AFC India Limited",
        html: wrapEmailBody(`
          <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.7;">
            ${escapeHtml(noteLabel)} for <strong>${escapeHtml(lead.title)}</strong> has been submitted for your approval.
          </p>
        `),
      });

      return jsonRes(req, 200, { success: true });
    }

    // ra_send_back
    const { error: updErr } = await adminClient
      .from("fee_notes")
      .update({ status: "draft", pr_signed_by: null, pr_signed_at: null })
      .eq("id", feeNoteId)
      .eq("status", "pending_recommending_authority");
    if (updErr) throw new Error(updErr.message);

    await adminClient.from("fee_note_events").insert({ fee_note_id: feeNoteId, actor_id: caller.id, actor_name: caller.email, action: "returned_by_ra", remark: remark || null });

    await notifyUsers(adminClient, [lead.person_responsible_id, lead.reviewer_id], {
      title: `${noteLabel} sent back for changes`,
      sub_text: `The Recommending Authority sent the ${noteLabel} for "${lead.title}" back: ${remark}`,
      type: "action_required",
      link: "/leads",
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
