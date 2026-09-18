// supabase/functions/respond-lead-query/index.ts
// JWT must be ON. PMT triages an open lead_queries row (see
// raise-lead-query) with one of three actions:
//   add_to_chat — adds the querying DGM/AGM/SRM to the lead's chat roster,
//                 no PIN (not a workflow decision, just visibility).
//   decline     — closes the query with PMT's own note, no PIN.
//   transfer    — moves the lead to the raiser's own team (see
//                 _shared/leadTransfer.ts) — PIN required, same as any
//                 other lead-workflow decision.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { addLeadChatParticipants } from "../_shared/leadAuth.ts";
import { notifyUser } from "../_shared/notify.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { performLeadTransfer } from "../_shared/leadTransfer.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const ACTIONS = new Set(["add_to_chat", "decline", "transfer"]);

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  if (caller.committee !== "PMT" && !["md", "admin"].includes(caller.role)) {
    return jsonRes(req, 403, { error: "Only a PMT committee member can respond to a lead query." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const queryId = typeof body.query_id === "string" ? body.query_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  const response = typeof body.response === "string" ? body.response.trim().slice(0, 2000) : "";
  if (!queryId) return jsonRes(req, 400, { error: "query_id is required." });
  if (!ACTIONS.has(action)) return jsonRes(req, 400, { error: `Unknown action "${action}".` });

  try {
    const { data: query, error: queryErr } = await adminClient
      .from("lead_queries")
      .select("id, lead_id, raised_by_id, raised_by_team, status")
      .eq("id", queryId)
      .maybeSingle();
    if (queryErr || !query) return jsonRes(req, 404, { error: "Query not found." });
    if (query.status !== "open") {
      return jsonRes(req, 400, { error: `This query is already "${query.status}".` });
    }

    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, lead_number, title")
      .eq("id", query.lead_id)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    if (action === "add_to_chat") {
      await addLeadChatParticipants(adminClient, query.lead_id, [query.raised_by_id], "cross_team_query");
      const { error: updateErr } = await adminClient
        .from("lead_queries")
        .update({ status: "added_to_chat", pmt_response: response || null, resolved_by_id: caller.id, resolved_at: new Date().toISOString() })
        .eq("id", queryId)
        .eq("status", "open");
      if (updateErr) return jsonRes(req, 400, { error: "This query was already updated by someone else — refresh and try again." });
      await logLeadActivity(adminClient, query.lead_id, caller.id, "pmt", "cross_team_query_added_to_chat", null, null, `${query.raised_by_team}${response ? ` — ${response}` : ""}`);
      await notifyUser(adminClient, query.raised_by_id, {
        title: "Added to lead discussion",
        sub_text: `PMT added you to the discussion for ${lead.lead_number} — "${lead.title}".`,
        type: "info",
        link: `/leads/${lead.id}`,
      });
      return jsonRes(req, 200, { success: true });
    }

    if (action === "decline") {
      const { error: updateErr } = await adminClient
        .from("lead_queries")
        .update({ status: "declined", pmt_response: response || null, resolved_by_id: caller.id, resolved_at: new Date().toISOString() })
        .eq("id", queryId)
        .eq("status", "open");
      if (updateErr) return jsonRes(req, 400, { error: "This query was already updated by someone else — refresh and try again." });
      await logLeadActivity(adminClient, query.lead_id, caller.id, "pmt", "cross_team_query_declined", null, null, `${query.raised_by_team}${response ? ` — ${response}` : ""}`);
      await notifyUser(adminClient, query.raised_by_id, {
        title: "Your lead query was declined",
        sub_text: `PMT declined your query on ${lead.lead_number} — "${lead.title}". ${response}`,
        type: "info",
        link: `/leads/${lead.id}`,
      });
      return jsonRes(req, 200, { success: true });
    }

    // action === "transfer"
    const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
    if (pinErr) return jsonRes(req, 400, { error: pinErr });

    const transferResult = await performLeadTransfer(
      adminClient,
      query.lead_id,
      query.raised_by_team,
      response || "Transferred in response to a cross-team query.",
      caller.id
    );
    if (!transferResult.ok) return jsonRes(req, 400, { error: transferResult.error });

    const { error: updateErr } = await adminClient
      .from("lead_queries")
      .update({ status: "transferred", pmt_response: response || null, resolved_by_id: caller.id, resolved_at: new Date().toISOString() })
      .eq("id", queryId)
      .eq("status", "open");
    if (updateErr) console.error("lead_queries status update after transfer failed:", updateErr.message);

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
