// supabase/functions/create-proposal-preparation/index.ts
// JWT must be ON. Idempotent create/fetch of the proposal_preparations row
// for an approved lead — "Open Proposal" calls this on first visit. Caller
// must be the lead's Person Responsible, Reviewer, or Approval Authority
// (the authorised signatory needs to reach the page too, to lock/decide
// outcome later), or md/admin. Mirrors create-lead's shape.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { getOrgWideHolders } from "../_shared/leadAuth.ts";
import { addProposalChatParticipants } from "../_shared/proposalChat.ts";

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

  const leadId = body.lead_id;
  if (typeof leadId !== "string" || !leadId) return jsonRes(req, 400, { error: "lead_id is required." });

  try {
    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, status, person_responsible_id, reviewer_id, approval_authority_id, assigned_ba_id")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    const authorized =
      ["md", "admin"].includes(caller.role) ||
      [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this lead's proposal." });

    if (lead.status !== "md_approved") {
      return jsonRes(req, 400, { error: "This lead has not been approved for proposal preparation yet." });
    }

    const { data: existing } = await adminClient
      .from("proposal_preparations")
      .select("id, chat_opened_at")
      .eq("lead_id", leadId)
      .maybeSingle();

    let proposalId: string;
    // Re-sync on every visit, not just first creation — covers a proposal
    // whose Reviewer/Approval Authority/BP was reassigned on the lead after
    // the proposal was first opened, and backfills chat_opened_at + the
    // roster for a proposal created before this chat feature existed
    // (existing.chat_opened_at null). Upserts are cheap/no-ops when nothing
    // actually changed, so re-running this isn't wasteful.
    let needsChatOpen = true;
    if (existing) {
      proposalId = existing.id;
      needsChatOpen = !existing.chat_opened_at;
    } else {
      const { data: created, error: insertErr } = await adminClient
        .from("proposal_preparations")
        .insert({ lead_id: leadId, created_by: caller.id, chat_opened_at: new Date().toISOString() })
        .select("id")
        .single();
      if (insertErr) throw new Error(insertErr.message);
      proposalId = created.id;
    }

    if (needsChatOpen && existing) {
      const { error: openErr } = await adminClient
        .from("proposal_preparations")
        .update({ chat_opened_at: new Date().toISOString() })
        .eq("id", proposalId);
      if (openErr) console.error("Failed to backfill chat_opened_at:", openErr.message);
    }

    // Chat roster: the lead's three named assignees, its assigned Business
    // Partner (only on their own proposal), and every MD org-wide (on
    // every proposal). ignoreDuplicates upserts make this safe to re-run.
    const namedIds = [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id, lead.assigned_ba_id].filter(Boolean);
    const mdHolders = await getOrgWideHolders(adminClient, { role: "md" });
    await addProposalChatParticipants(adminClient, proposalId, namedIds, "named");
    await addProposalChatParticipants(adminClient, proposalId, mdHolders, "md");

    return jsonRes(req, 200, { success: true, proposal_id: proposalId });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
