// supabase/functions/update-lead-query/index.ts
// JWT must be ON. The raiser-side counterpart to respond-lead-query — only
// the person who raised a lead_queries row can act here, and only while
// it's still "open" (once PMT has triaged it — added_to_chat/declined/
// transferred — it's settled history, not editable). Three actions:
//   edit     — changes the justification text, stamps edited_at.
//   withdraw — pulls the query back (status "withdrawn", stamps
//              removed_at) — this is what frees the raiser up to raise a
//              fresh query later (raise-lead-query's existingOpen check
//              only blocks on status = 'open').
//   remind   — no DB change to the query itself, just re-notifies PMT
//              (raise-lead-query's own notify, repeated) for a query
//              that's been sitting open a while.
// All three log to lead_activity_log so they show up on the lead's
// Timeline, same as every other lead-workflow action in this module.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { getOrgWideHolders } from "../_shared/leadAuth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const ACTIONS = new Set(["edit", "withdraw", "remind"]);

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

  const queryId = typeof body.query_id === "string" ? body.query_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!queryId) return jsonRes(req, 400, { error: "query_id is required." });
  if (!ACTIONS.has(action)) return jsonRes(req, 400, { error: `Unknown action "${action}".` });

  try {
    const { data: query, error: queryErr } = await adminClient
      .from("lead_queries")
      .select("id, lead_id, raised_by_id, raised_by_team, status")
      .eq("id", queryId)
      .maybeSingle();
    if (queryErr || !query) return jsonRes(req, 404, { error: "Query not found." });
    if (query.raised_by_id !== caller.id) return jsonRes(req, 403, { error: "You can only manage your own query." });
    if (query.status !== "open") return jsonRes(req, 400, { error: `This query is already "${query.status}" and can no longer be changed.` });

    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, lead_number, title")
      .eq("id", query.lead_id)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    const pmtHolders = await getOrgWideHolders(adminClient, { committee: "PMT" });

    if (action === "edit") {
      const justification = typeof body.justification === "string" ? body.justification.trim().slice(0, 2000) : "";
      if (!justification) return jsonRes(req, 400, { error: "A justification is required." });

      const { error: updateErr } = await adminClient
        .from("lead_queries")
        .update({ justification, edited_at: new Date().toISOString() })
        .eq("id", queryId)
        .eq("status", "open");
      if (updateErr) return jsonRes(req, 400, { error: "This query was already updated — refresh and try again." });

      await logLeadActivity(adminClient, query.lead_id, caller.id, caller.role, "cross_team_query_edited", null, null, `${query.raised_by_team}: ${justification}`);
      await notifyUsers(adminClient, pmtHolders, {
        title: "A cross-team query was edited",
        sub_text: `${lead.lead_number} — "${lead.title}" (${query.raised_by_team}): the justification was updated.`,
        type: "info",
        link: `/leads/${lead.id}`,
      });
      return jsonRes(req, 200, { success: true });
    }

    if (action === "withdraw") {
      const { error: updateErr } = await adminClient
        .from("lead_queries")
        .update({ status: "withdrawn", removed_at: new Date().toISOString() })
        .eq("id", queryId)
        .eq("status", "open");
      if (updateErr) return jsonRes(req, 400, { error: "This query was already updated — refresh and try again." });

      await logLeadActivity(adminClient, query.lead_id, caller.id, caller.role, "cross_team_query_withdrawn", null, null, query.raised_by_team);
      await notifyUsers(adminClient, pmtHolders, {
        title: "A cross-team query was withdrawn",
        sub_text: `${lead.lead_number} — "${lead.title}": ${query.raised_by_team} withdrew their query.`,
        type: "info",
        link: `/leads/${lead.id}`,
      });
      return jsonRes(req, 200, { success: true });
    }

    // action === "remind"
    await logLeadActivity(adminClient, query.lead_id, caller.id, caller.role, "cross_team_query_reminder_sent", null, null, query.raised_by_team);
    await notifyUsers(adminClient, pmtHolders, {
      title: "Reminder: cross-team query awaiting a response",
      sub_text: `${lead.lead_number} — "${lead.title}" (${query.raised_by_team}): still waiting on PMT to triage this query.`,
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
