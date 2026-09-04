// supabase/functions/lock-proposal/index.ts
// JWT must be ON. Person Responsible / Reviewer / Approval Authority (the
// authorised signatory) manually locks a proposal — e.g. once it's been
// submitted to the client. Locking also happens automatically once the
// lead's own submission_deadline passes — that path needs no edge function
// since can_edit_proposal() already folds the deadline check into every
// direct-RLS write, and this function's own guards do the same for the
// state-changing actions that go through edge functions.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

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

  const proposalId = body.proposal_id;
  if (typeof proposalId !== "string" || !proposalId) return jsonRes(req, 400, { error: "proposal_id is required." });

  try {
    const { data: proposal, error: propErr } = await adminClient
      .from("proposal_preparations")
      .select("id, lead_id, locked")
      .eq("id", proposalId)
      .maybeSingle();
    if (propErr || !proposal) return jsonRes(req, 404, { error: "Proposal not found." });
    if (proposal.locked) return jsonRes(req, 400, { error: "This proposal is already locked." });

    const { data: lead } = await adminClient
      .from("leads")
      .select("person_responsible_id, reviewer_id, approval_authority_id")
      .eq("id", proposal.lead_id)
      .maybeSingle();

    const authorized =
      ["md", "admin"].includes(caller.role) ||
      [lead?.person_responsible_id, lead?.reviewer_id, lead?.approval_authority_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this proposal." });

    const { error: updErr } = await adminClient
      .from("proposal_preparations")
      .update({ locked: true, locked_at: new Date().toISOString(), locked_by: caller.id, lock_reason: "manual" })
      .eq("id", proposalId);
    if (updErr) throw new Error(updErr.message);

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
