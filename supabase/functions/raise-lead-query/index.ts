// supabase/functions/raise-lead-query/index.ts
// JWT must be ON. A DGM/AGM/SRM who spots another team's lead (now
// org-wide visible — see 20260928000200_lead_org_wide_visibility.sql) and
// believes their own team could run it better raises a query here, with a
// justification. PMT triages it (see respond-lead-query): add the raiser
// to the lead's chat, decline it, or transfer the lead outright (see
// transfer-lead). This never changes the lead itself — just opens a
// lead_queries row PMT can act on.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { getOrgWideHolders } from "../_shared/leadAuth.ts";
import { notifyUsers } from "../_shared/notify.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

// Same tier as everywhere else in this module that treats SRM like AGM.
const QUERY_RAISER_ROLES = ["dgm", "agm", "srm"];

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

  const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
  const justification = typeof body.justification === "string" ? body.justification.trim().slice(0, 2000) : "";
  if (!leadId) return jsonRes(req, 400, { error: "lead_id is required." });
  if (!justification) return jsonRes(req, 400, { error: "A justification is required." });

  if (!QUERY_RAISER_ROLES.includes(caller.role)) {
    return jsonRes(req, 403, { error: "Only a DGM, AGM, or SRM can raise a query on a lead." });
  }

  try {
    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, lead_number, title, team")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    if (caller.teams.includes(lead.team)) {
      return jsonRes(req, 400, { error: "You're already on this lead's own team — raising a query is only for a lead outside your team(s)." });
    }

    const { data: existingOpen } = await adminClient
      .from("lead_queries")
      .select("id")
      .eq("lead_id", leadId)
      .eq("raised_by_id", caller.id)
      .eq("status", "open")
      .maybeSingle();
    if (existingOpen) return jsonRes(req, 400, { error: "You already have an open query on this lead — wait for PMT to respond." });

    const { error: insertErr } = await adminClient.from("lead_queries").insert({
      lead_id: leadId,
      raised_by_id: caller.id,
      raised_by_team: caller.team,
      justification,
    });
    if (insertErr) {
      console.error("lead_queries insert failed:", insertErr.message);
      return jsonRes(req, 500, { error: "Failed to raise query. Please try again." });
    }

    const pmtHolders = await getOrgWideHolders(adminClient, { committee: "PMT" });
    await notifyUsers(adminClient, pmtHolders, {
      title: "Cross-team query raised on a lead",
      sub_text: `${lead.lead_number} — "${lead.title}" (${lead.team}): a query was raised. ${justification}`,
      type: "action_required",
      link: `/leads/${lead.id}`,
    });

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
