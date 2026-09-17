// supabase/functions/decide-fee-note-md/index.ts
// JWT must be ON. MD's final decision on the Bid Payment Requisition Note,
// gated by the MD's own 4-digit action PIN (same
// verifyActionPin used across the Lead/Empanelment workflows) — replaces
// the previous email-OTP round trip (request-fee-note-otp/feeNoteOtp.ts,
// both deleted). Approval stamps md_decided_by/at as the MD's signature on
// the note. Rejection sends the note all the way back to draft, clearing
// both the Person Responsible's and Recommending Authority's signatures since
// a changed note needs fresh sign-off from both before it can reach the MD
// again (see advance-fee-note-stage for the first two hops).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { notifyUsers } from "../_shared/notify.ts";

const NOTE_LABEL = "Bid Payment Requisition Note";

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;
  // No admin override, same as the two earlier hops in advance-fee-note-
  // stage — md_decided_by prints under "Managing Director" on the note, so
  // it must actually be an MD who decided, not an admin acting on their
  // behalf (matches this function's original, pre-PIN behavior).
  if (caller.role !== "md") return jsonRes(req, 403, { error: "Only the MD can decide at this stage." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const feeNoteId = body.fee_note_id;
  const decision = body.decision;
  const remark = typeof body.remark === "string" ? body.remark.trim() : null;
  if (typeof feeNoteId !== "string" || !feeNoteId) return jsonRes(req, 400, { error: "fee_note_id is required." });
  if (decision !== "approved" && decision !== "rejected") return jsonRes(req, 400, { error: "Invalid decision." });
  if (decision === "rejected" && !remark) return jsonRes(req, 400, { error: "A remark is required when sending a note back." });

  const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
  if (pinErr) return jsonRes(req, 400, { error: pinErr });

  try {
    const { data: note, error: fetchErr } = await adminClient
      .from("fee_notes")
      .select("id, proposal_id, status")
      .eq("id", feeNoteId)
      .maybeSingle();
    if (fetchErr || !note) return jsonRes(req, 404, { error: "Fee note not found." });
    if (note.status !== "pending_md") {
      return jsonRes(req, 400, { error: `This fee note is "${note.status}", not "pending_md". It may have just been updated by someone else — refresh and try again.` });
    }

    const { data: proposal } = await adminClient
      .from("proposal_preparations")
      .select("lead_id")
      .eq("id", note.proposal_id)
      .maybeSingle();
    const { data: lead } = await adminClient
      .from("leads")
      .select("title, person_responsible_id, reviewer_id, recommending_authority_id")
      .eq("id", proposal?.lead_id)
      .maybeSingle();

    const updates: Record<string, unknown> =
      decision === "approved"
        ? { status: "approved", md_decided_by: caller.id, md_decided_at: new Date().toISOString(), md_remark: remark }
        : { status: "draft", md_decided_by: null, md_decided_at: null, md_remark: null, pr_signed_by: null, pr_signed_at: null, ra_signed_by: null, ra_signed_at: null };

    const { error: updErr } = await adminClient.from("fee_notes").update(updates).eq("id", feeNoteId).eq("status", "pending_md");
    if (updErr) throw new Error(updErr.message);

    await adminClient.from("fee_note_events").insert({
      fee_note_id: feeNoteId, actor_id: caller.id, actor_name: "Managing Director",
      action: decision === "approved" ? "md_approved" : "md_rejected", remark,
    });

    const noteLabel = NOTE_LABEL;
    await notifyUsers(adminClient, [lead?.person_responsible_id, lead?.reviewer_id, lead?.recommending_authority_id], {
      title: decision === "approved" ? `${noteLabel} approved` : `${noteLabel} sent back`,
      sub_text: decision === "approved"
        ? `The MD approved the ${noteLabel} for "${lead?.title}".`
        : `The MD sent the ${noteLabel} for "${lead?.title}" back: ${remark}`,
      type: decision === "approved" ? "info" : "action_required",
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
