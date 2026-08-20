// supabase/functions/decide-fee-note-md/index.ts
// JWT must be ON. MD's final decision on a fee note (EMD / Tender Fee /
// PBG), gated by the OTP issued via request-fee-note-otp. Nothing mutates
// and no notification goes out until the code is confirmed. There's no
// committee chain to route a rejection back to — a rejected note is simply
// edited and resubmitted by Person Responsible/Reviewer via save-fee-notes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { verifyFeeNoteOtp } from "../_shared/feeNoteOtp.ts";
import { notifyUsers } from "../_shared/notify.ts";

const NOTE_LABELS: Record<string, string> = { emd: "EMD Note", tender_fee: "Tender Fee Note", pbg: "PBG Note" };

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;
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

  const otpAction = decision === "approved" ? "md_approve" : "md_reject";
  const verified = await verifyFeeNoteOtp(adminClient, { userId: caller.id, feeNoteId, action: otpAction, otp: body.otp });
  if (!verified) return jsonRes(req, 400, { error: "Invalid or expired verification code." });

  try {
    const { data: note, error: fetchErr } = await adminClient
      .from("fee_notes")
      .select("id, note_type, proposal_id, status")
      .eq("id", feeNoteId)
      .maybeSingle();
    if (fetchErr || !note) return jsonRes(req, 404, { error: "Fee note not found." });
    if (note.status !== "pending_md") {
      return jsonRes(req, 400, { error: `This fee note is "${note.status}", not "pending_md".` });
    }

    const { data: proposal } = await adminClient
      .from("proposal_preparations")
      .select("lead_id")
      .eq("id", note.proposal_id)
      .maybeSingle();
    const { data: lead } = await adminClient
      .from("leads")
      .select("title, person_responsible_id, reviewer_id")
      .eq("id", proposal?.lead_id)
      .maybeSingle();

    const { error: updErr } = await adminClient
      .from("fee_notes")
      .update({ status: decision, md_decided_by: caller.id, md_decided_at: new Date().toISOString(), md_remark: remark })
      .eq("id", feeNoteId);
    if (updErr) throw new Error(updErr.message);

    await adminClient.from("fee_note_events").insert({
      fee_note_id: feeNoteId, actor_id: caller.id, actor_name: "Managing Director",
      action: decision === "approved" ? "md_approved" : "md_rejected", remark,
    });

    const noteLabel = NOTE_LABELS[note.note_type] || note.note_type;
    await notifyUsers(adminClient, [lead?.person_responsible_id, lead?.reviewer_id], {
      title: decision === "approved" ? `${noteLabel} approved` : `${noteLabel} needs changes`,
      sub_text: decision === "approved"
        ? `The MD approved the ${noteLabel} for "${lead?.title}".`
        : `The MD sent the ${noteLabel} for "${lead?.title}" back: ${remark || "no remark given"}`,
      type: "info",
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
