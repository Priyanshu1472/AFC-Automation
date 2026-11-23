// supabase/functions/add-proposal-responsible/index.ts
// JWT must be ON. Lets the lead's own Person Responsible, Reviewer or
// Recommending Authority (or MD/Admin, or — once added — another
// additional responsible) add one more team member to a proposal, giving
// them the exact same proposal access as the Person Responsible: every
// proposal-prep table's write policy gates through can_edit_proposal(),
// and reads through can_view_proposal() -> can_view_lead(), both widened
// in 20261112000000_proposal_additional_responsibles to recognise rows in
// proposal_additional_responsibles — so inserting the one row here, plus
// the proposal's own chat roster so they can actually post in it, is the
// whole job.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
import { checkCanEditProposal } from "../_shared/proposalAuth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

// Same hands-on-tier filter LeadForm uses for its own Person Responsible
// field — excludes Business Partners and the AGM/SRM/DGM/General Manager
// oversight tier, who are a different kind of role on a proposal.
const EXCLUDED_ROLES = ["business_associate", "agm", "srm", "dgm", "general_manager"];

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

  const { data: target } = await adminClient
    .from("afc_users")
    .select("id, full_name, role, team, is_active")
    .eq("id", user_id)
    .maybeSingle();
  if (!target || !target.is_active) return jsonRes(req, 400, { error: "That user isn't active." });
  if (lead.team && target.team !== lead.team) return jsonRes(req, 400, { error: "Only users on this proposal's own team can be added." });
  if (EXCLUDED_ROLES.includes(target.role)) return jsonRes(req, 400, { error: "This role can't be added as a Person Responsible." });
  if ([lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(user_id)) {
    return jsonRes(req, 400, { error: "They're already named on this lead." });
  }

  const { error: insertErr } = await adminClient
    .from("proposal_additional_responsibles")
    .insert({ proposal_id: proposal.id, user_id, added_by: caller.id });
  if (insertErr) {
    if ((insertErr as { code?: string }).code === "23505") return jsonRes(req, 400, { error: "They're already added to this proposal." });
    return jsonRes(req, 500, { error: "Failed to add. Try again." });
  }

  // Best-effort — the proposal is already correct either way; a missed
  // chat upsert just means they'd need re-adding to post there.
  await adminClient
    .from("proposal_chat_participants")
    .upsert({ proposal_id: proposal.id, user_id, role_at_add: "additional_pr", added_by: caller.id }, { onConflict: "proposal_id,user_id", ignoreDuplicates: true });

  const { data: callerRow } = await adminClient.from("afc_users").select("full_name").eq("id", caller.id).maybeSingle();

  await logLeadActivity(
    adminClient, lead_id, caller.id, caller.role, "proposal_responsible_added", lead.status, lead.status,
    `Added ${target.full_name} as an additional Person Responsible on the proposal.`
  );

  await notifyUsers(adminClient, [user_id], {
    title: `${callerRow?.full_name || "Someone"} added you as an additional Person Responsible on ${lead.lead_number} — "${lead.title}"`,
    type: "action_required",
    link: `/proposals/${lead_id}`,
  });

  return jsonRes(req, 200, { success: true });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
