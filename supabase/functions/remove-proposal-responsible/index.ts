// supabase/functions/remove-proposal-responsible/index.ts
// JWT must be ON. The other half of add-proposal-responsible: drops one
// additional responsible from a proposal (and the chat roster row that
// came with them), so they stop getting the Person-Responsible-level
// access that row granted via can_edit_proposal()/can_view_lead().

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
import { checkCanEditProposal } from "../_shared/proposalAuth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

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

  const { lead_id, user_id } = body;
  if (!lead_id || typeof lead_id !== "string") return jsonRes(req, 400, { error: "lead_id is required." });
  if (!user_id || typeof user_id !== "string") return jsonRes(req, 400, { error: "user_id is required." });

  const check = await checkCanEditProposal(adminClient, lead_id, caller);
  if (!check.ok) return jsonRes(req, check.status, { error: check.error });
  const { proposal, lead } = check;

  const { data: target } = await adminClient.from("afc_users").select("full_name").eq("id", user_id).maybeSingle();

  const { error: delErr } = await adminClient
    .from("proposal_additional_responsibles")
    .delete()
    .eq("proposal_id", proposal.id)
    .eq("user_id", user_id);
  if (delErr) return jsonRes(req, 500, { error: "Failed to remove. Try again." });

  await adminClient
    .from("proposal_chat_participants")
    .delete()
    .eq("proposal_id", proposal.id)
    .eq("user_id", user_id)
    .eq("role_at_add", "additional_pr");

  await adminClient.rpc("log_proposal_activity", {
    p_proposal_id: proposal.id, p_action: "responsible_removed", p_actor: caller.id, p_detail: target?.full_name || null,
  }).then(({ error }) => { if (error) console.error("timeline log failed:", error.message); });

  await logLeadActivity(
    adminClient, lead_id, caller.id, caller.role, "proposal_responsible_removed", lead.status, lead.status,
    `Removed ${target?.full_name || "a user"} as an additional Person Responsible on the proposal.`
  );

  return jsonRes(req, 200, { success: true });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
