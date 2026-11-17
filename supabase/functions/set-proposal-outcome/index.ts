// supabase/functions/set-proposal-outcome/index.ts
// JWT must be ON. Person Responsible / Reviewer / Recommending Authority
// manually records the client's answer (Awarded / Rejected) after the
// proposal has been locked — there is no automated feed for this, staff
// enter it once they hear back. Recorded once only. An "awarded" answer
// opens the project in Monitoring (DB trigger open_monitoring_on_award, see
// 20261008020000_monitoring_and_financials.sql); a rejected one never does.
//
// When the approved Bid Payment Requisition Note carried an EMD, the EMD's
// own follow-up starts here: a not-awarded proposal opens an EMD refund
// (pending until the team marks it received — reminded every 14 days); an
// awarded one asks the team to choose EMD refund, conversion to PBG or
// refund on completion
// (proposal-emd-action).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { moduleOffResponse } from "../_shared/modules.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { KIND_EMD, teamIds, leadRef, rupees } from "../_shared/proposalFinance.ts";

const OUTCOMES = new Set(["awarded", "rejected"]);

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
  const outcome = body.outcome;
  const remark = typeof body.remark === "string" ? body.remark.trim() : null;
  if (typeof proposalId !== "string" || !proposalId) return jsonRes(req, 400, { error: "proposal_id is required." });
  if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) return jsonRes(req, 400, { error: "outcome must be \"awarded\" or \"rejected\"." });

  try {
    const { data: proposal, error: propErr } = await adminClient
      .from("proposal_preparations")
      .select("id, lead_id, locked, client_response")
      .eq("id", proposalId)
      .maybeSingle();
    if (propErr || !proposal) return jsonRes(req, 404, { error: "Proposal not found." });
    if (!proposal.locked) return jsonRes(req, 400, { error: "Lock the proposal before recording the client's response." });
    if (proposal.client_response !== "pending") return jsonRes(req, 400, { error: "The client's response has already been recorded for this proposal." });

    const { data: lead } = await adminClient
      .from("leads")
      .select("id, lead_number, title, person_responsible_id, reviewer_id, recommending_authority_id")
      .eq("id", proposal.lead_id)
      .maybeSingle();

    const authorized =
      ["md", "admin"].includes(caller.role) ||
      [lead?.person_responsible_id, lead?.reviewer_id, lead?.recommending_authority_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this proposal." });

    const { error: updErr } = await adminClient
      .from("proposal_preparations")
      .update({
        client_response: outcome,
        client_response_at: new Date().toISOString(),
        client_response_by: caller.id,
        client_response_remark: remark,
      })
      .eq("id", proposalId);
    if (updErr) throw new Error(updErr.message);

    if (lead) await startEmdFollowUp(adminClient, proposalId, outcome, lead, caller.id);

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

// Best-effort: a failure here must never undo the recorded response.
async function startEmdFollowUp(
  adminClient: ReturnType<typeof createAdminClient>,
  proposalId: string,
  outcome: string,
  lead: { id: string; lead_number: string; title: string; person_responsible_id: string | null; reviewer_id: string | null; recommending_authority_id: string | null },
  callerId: string,
) {
  try {
    const { data: note } = await adminClient
      .from("fee_notes")
      .select("emd_amount")
      .eq("proposal_id", proposalId)
      .eq("status", "approved")
      .maybeSingle();
    const emd = note?.emd_amount != null ? Number(note.emd_amount) : 0;
    if (!(emd > 0)) return;

    const link = `/proposals/${lead.id}`;
    if (outcome === "rejected") {
      const { error } = await adminClient.from("proposal_emd_tracking").upsert(
        { proposal_id: proposalId, track: "refund", status: "pending", emd_amount: emd, created_by: callerId },
        { onConflict: "proposal_id", ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
      await adminClient.from("proposal_finance_events").insert({ proposal_id: proposalId, scope: "emd", action: "refund_opened", actor_id: callerId });
      await notifyUsers(adminClient, teamIds(lead), {
        title: "EMD refund to follow up",
        sub_text: `${leadRef(lead)} was not awarded. Follow up on the EMD refund of ${rupees(emd)} and mark it Received with proof once it comes back.`,
        type: "action_required",
        link,
        kind: KIND_EMD,
      });
    } else {
      await notifyUsers(adminClient, teamIds(lead), {
        title: "Choose what happens to the EMD",
        sub_text: `${leadRef(lead)} was awarded. Choose EMD Refund, Converted to PBG or On Completion for the EMD of ${rupees(emd)}, and prepare the PBG Note if a PBG is required.`,
        type: "action_required",
        link,
        kind: KIND_EMD,
      });
    }
  } catch (err) {
    console.error("EMD follow-up failed:", (err as Error).message);
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
