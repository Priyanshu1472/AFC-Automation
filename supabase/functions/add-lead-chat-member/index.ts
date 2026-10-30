// supabase/functions/add-lead-chat-member/index.ts
// JWT must be ON. Lets a PMT member add a DGM-tier user (dgm/agm/srm/
// general_manager, any team) to a lead's chat roster from the chat panel's
// "Add member" button. Those roles already see every lead org-wide, so the
// roster is the only thing they were missing (see
// 20261030040000_lead_chat_add_member.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { addLeadChatParticipants, getTargetUser } from "../_shared/leadAuth.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const DGM_TIER_ROLES = ["dgm", "agm", "srm", "general_manager"];

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  if (caller.committee !== "PMT") return jsonRes(req, 403, { error: "Only PMT members can add people to the chat." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const { lead_id, user_id } = body;
  if (!lead_id || typeof lead_id !== "string") return jsonRes(req, 400, { error: "lead_id is required." });
  if (!user_id || typeof user_id !== "string") return jsonRes(req, 400, { error: "user_id is required." });

  const { data: lead, error: leadErr } = await adminClient
    .from("leads")
    .select("id, status, chat_opened_at, lead_number, title")
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

  if (!lead.chat_opened_at) return jsonRes(req, 400, { error: "Chat isn't open for this lead yet." });
  if (lead.status === "md_approved") return jsonRes(req, 400, { error: "This lead has been approved — the chat is closed." });

  const target = await getTargetUser(adminClient, user_id);
  if (!target || !target.is_active) return jsonRes(req, 400, { error: "That user isn't active." });
  if (!DGM_TIER_ROLES.includes(target.role)) {
    return jsonRes(req, 400, { error: "Only DGM, AGM, SRM or General Manager users can be added to a lead chat." });
  }

  const { data: existing } = await adminClient
    .from("lead_chat_participants")
    .select("id")
    .eq("lead_id", lead_id)
    .eq("user_id", user_id)
    .maybeSingle();
  if (existing) return jsonRes(req, 400, { error: "They're already in this chat." });

  await addLeadChatParticipants(adminClient, lead_id, [user_id], "added");

  const { data: names } = await adminClient.from("afc_users").select("id, full_name").in("id", [caller.id, user_id]);
  const nameOf = (id: string) => (names || []).find((n: { id: string }) => n.id === id)?.full_name || "Someone";

  await logLeadActivity(adminClient, lead_id, caller.id, "pmt", "chat_member_added", lead.status, lead.status, `Added ${nameOf(user_id)} to the discussion.`);

  await notifyUsers(adminClient, [user_id], {
    title: `${nameOf(caller.id)} added you to the discussion on ${lead.lead_number} — "${lead.title}"`,
    type: "info",
    link: `/leads/${lead_id}`,
  });

  return jsonRes(req, 200, { success: true });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
