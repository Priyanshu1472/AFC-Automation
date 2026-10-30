// supabase/functions/respond-lead-query/index.ts
// JWT must be ON. PMT (or MD) triages a lead_queries row (see
// raise-lead-query) with one of these actions:
//   add_to_chat  — adds the querying DGM/AGM/SRM to the lead's chat roster,
//                  no PIN (not a workflow decision, just visibility). Only
//                  valid from "open" — can't add-to-chat twice.
//   decline      — closes the query with the responder's own note, no PIN.
//   transfer     — PIN required. From MD: moves the lead to the chosen team
//                  right away (see _shared/leadTransfer.ts). From PMT (or
//                  admin): only *requests* it — the query goes to
//                  "transfer_pending" with the proposed team/forward-to
//                  parked on the row, and MD is notified to decide.
//   approve_transfer — MD only, PIN required: runs the pending transfer.
//   reject_transfer  — MD only, remarks required: drops the request and
//                  puts the query back to whatever status it had before,
//                  so PMT can still add-to-chat/decline/re-request.
// decline/transfer are both valid from "open" OR "added_to_chat" — adding
// the raiser to the chat is a visibility step, not a resolution. Only
// "transferred"/"declined"/"withdrawn" are actually terminal.
//
// transfer requires target_team and forwarded_to_id in the body — picked
// explicitly (target_team defaults to the raiser's team in the UI, but
// isn't forced to it), rather than the lead auto-routing to the whole new
// team's PO tier.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { addLeadChatParticipants, getOrgWideHolders } from "../_shared/leadAuth.ts";
import { notifyUser, notifyUsers } from "../_shared/notify.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { performLeadTransfer } from "../_shared/leadTransfer.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
import { validateForwardedTo } from "../_shared/leadEligibility.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const ACTIONS = new Set(["add_to_chat", "decline", "transfer", "approve_transfer", "reject_transfer"]);
const MD_ONLY_ACTIONS = new Set(["approve_transfer", "reject_transfer"]);

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
  const isMd = caller.role === "md";
  if (MD_ONLY_ACTIONS.has(action) && !isMd) return jsonRes(req, 403, { error: "Only MD can approve or reject a lead transfer." });
  const responderRole = isMd ? "md" : "pmt";

  try {
    const { data: query, error: queryErr } = await adminClient
      .from("lead_queries")
      .select("id, lead_id, raised_by_id, raised_by_team, status, resolved_by_id, transfer_target_team, transfer_forwarded_to_id, pre_transfer_status")
      .eq("id", queryId)
      .maybeSingle();
    if (queryErr || !query) return jsonRes(req, 404, { error: "Query not found." });
    if (MD_ONLY_ACTIONS.has(action)) {
      if (query.status !== "transfer_pending") return jsonRes(req, 400, { error: "There's no pending transfer request on this query." });
    } else if (query.status === "transfer_pending") {
      return jsonRes(req, 400, { error: "A transfer request on this query is awaiting MD's decision." });
    } else if (query.status !== "open" && query.status !== "added_to_chat") {
      return jsonRes(req, 400, { error: `This query is already "${query.status}".` });
    }
    if (action === "add_to_chat" && query.status !== "open") {
      return jsonRes(req, 400, { error: "The raiser has already been added to the chat." });
    }

    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, lead_number, title, team")
      .eq("id", query.lead_id)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    if (action === "add_to_chat") {
      await addLeadChatParticipants(adminClient, query.lead_id, [query.raised_by_id], "cross_team_query");
      const { error: updateErr } = await adminClient
        .from("lead_queries")
        .update({ status: "added_to_chat", pmt_response: response || null, resolved_by_id: caller.id, resolved_by_role: responderRole, resolved_at: new Date().toISOString() })
        .eq("id", queryId)
        .eq("status", "open");
      if (updateErr) return jsonRes(req, 400, { error: "This query was already updated by someone else — refresh and try again." });
      await logLeadActivity(adminClient, query.lead_id, caller.id, responderRole, "cross_team_query_added_to_chat", null, null, `${query.raised_by_team}${response ? ` — ${response}` : ""}`);
      await notifyUser(adminClient, query.raised_by_id, {
        title: "Added to lead discussion",
        sub_text: `${isMd ? "MD" : "PMT"} added you to the discussion for ${lead.lead_number} — "${lead.title}".`,
        type: "info",
        link: `/leads/${lead.id}`,
      });
      return jsonRes(req, 200, { success: true });
    }

    if (action === "decline") {
      const { error: updateErr } = await adminClient
        .from("lead_queries")
        .update({ status: "declined", pmt_response: response || null, resolved_by_id: caller.id, resolved_by_role: responderRole, resolved_at: new Date().toISOString() })
        .eq("id", queryId)
        .in("status", ["open", "added_to_chat"]);
      if (updateErr) return jsonRes(req, 400, { error: "This query was already updated by someone else — refresh and try again." });
      await logLeadActivity(adminClient, query.lead_id, caller.id, responderRole, "cross_team_query_declined", null, null, `${query.raised_by_team}${response ? ` — ${response}` : ""}`);
      await notifyUser(adminClient, query.raised_by_id, {
        title: "Your lead query was declined",
        sub_text: `${isMd ? "MD" : "PMT"} declined your query on ${lead.lead_number} — "${lead.title}". ${response}`,
        type: "info",
        link: `/leads/${lead.id}`,
      });
      return jsonRes(req, 200, { success: true });
    }

    if (action === "reject_transfer") {
      if (!response) return jsonRes(req, 400, { error: "Remarks are required to reject a transfer." });
      const { error: updateErr } = await adminClient
        .from("lead_queries")
        .update({
          status: query.pre_transfer_status || "open",
          transfer_target_team: null,
          transfer_forwarded_to_id: null,
          pre_transfer_status: null,
          md_response: response,
          md_decided_by_id: caller.id,
          md_decided_at: new Date().toISOString(),
        })
        .eq("id", queryId)
        .eq("status", "transfer_pending");
      if (updateErr) return jsonRes(req, 400, { error: "This query was already updated by someone else — refresh and try again." });
      await logLeadActivity(adminClient, query.lead_id, caller.id, "md", "lead_transfer_rejected", null, null, `${query.transfer_target_team} — ${response}`);
      if (query.resolved_by_id) {
        await notifyUser(adminClient, query.resolved_by_id, {
          title: "Lead transfer rejected by MD",
          sub_text: `MD rejected transferring ${lead.lead_number} — "${lead.title}" to ${query.transfer_target_team}. ${response}`,
          type: "info",
          link: `/leads/${lead.id}`,
        });
      }
      return jsonRes(req, 200, { success: true });
    }

    const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
    if (pinErr) return jsonRes(req, 400, { error: pinErr });

    if (action === "approve_transfer") {
      const transferResult = await performLeadTransfer(
        adminClient,
        query.lead_id,
        query.transfer_target_team as string,
        query.transfer_forwarded_to_id as string,
        response || "Transfer approved by MD.",
        caller.id
      );
      if (!transferResult.ok) return jsonRes(req, 400, { error: transferResult.error });

      const { error: updateErr } = await adminClient
        .from("lead_queries")
        .update({ status: "transferred", md_response: response || null, md_decided_by_id: caller.id, md_decided_at: new Date().toISOString() })
        .eq("id", queryId)
        .eq("status", "transfer_pending");
      if (updateErr) console.error("lead_queries status update after approved transfer failed:", updateErr.message);

      if (query.resolved_by_id) {
        await notifyUser(adminClient, query.resolved_by_id, {
          title: "Lead transfer approved by MD",
          sub_text: `${lead.lead_number} — "${lead.title}" was transferred to ${query.transfer_target_team} (now ${transferResult.leadNumber}).`,
          type: "info",
          link: `/leads/${lead.id}`,
        });
      }
      return jsonRes(req, 200, { success: true });
    }

    // action === "transfer"
    const targetTeam = typeof body.target_team === "string" ? body.target_team : "";
    const forwardedToId = typeof body.forwarded_to_id === "string" ? body.forwarded_to_id : "";
    if (!targetTeam) return jsonRes(req, 400, { error: "Select a team to transfer to." });
    if (!forwardedToId) return jsonRes(req, 400, { error: "Select who to forward the lead to." });

    if (!isMd) {
      // PMT can only request it — validate the choice now so MD isn't
      // handed a request that can never succeed.
      if (targetTeam === lead.team) return jsonRes(req, 400, { error: "This lead is already on that team." });
      const forwardErr = await validateForwardedTo(adminClient, forwardedToId, targetTeam);
      if (forwardErr) return jsonRes(req, 400, { error: forwardErr });

      const { error: updateErr } = await adminClient
        .from("lead_queries")
        .update({
          status: "transfer_pending",
          pre_transfer_status: query.status,
          transfer_target_team: targetTeam,
          transfer_forwarded_to_id: forwardedToId,
          pmt_response: response || null,
          resolved_by_id: caller.id,
          resolved_by_role: "pmt",
          resolved_at: new Date().toISOString(),
          md_response: null,
          md_decided_by_id: null,
          md_decided_at: null,
        })
        .eq("id", queryId)
        .in("status", ["open", "added_to_chat"]);
      if (updateErr) return jsonRes(req, 400, { error: "This query was already updated by someone else — refresh and try again." });

      await logLeadActivity(adminClient, query.lead_id, caller.id, "pmt", "lead_transfer_requested", null, null, `${lead.team} → ${targetTeam}${response ? ` — ${response}` : ""}`);
      const mdHolders = await getOrgWideHolders(adminClient, { role: "md" });
      await notifyUsers(adminClient, mdHolders, {
        title: "Lead transfer awaiting your approval",
        sub_text: `PMT requested transferring ${lead.lead_number} — "${lead.title}" from ${lead.team} to ${targetTeam}.`,
        type: "action_required",
        link: `/leads/${lead.id}`,
      });
      return jsonRes(req, 200, { success: true, pending: true });
    }

    const transferResult = await performLeadTransfer(
      adminClient,
      query.lead_id,
      targetTeam,
      forwardedToId,
      response || "Transferred in response to a cross-team query.",
      caller.id
    );
    if (!transferResult.ok) return jsonRes(req, 400, { error: transferResult.error });

    const { error: updateErr } = await adminClient
      .from("lead_queries")
      .update({ status: "transferred", pmt_response: response || null, resolved_by_id: caller.id, resolved_by_role: "md", resolved_at: new Date().toISOString() })
      .eq("id", queryId)
      .in("status", ["open", "added_to_chat"]);
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
