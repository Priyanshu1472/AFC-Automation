// supabase/functions/raise-lead-query/index.ts
// JWT must be ON. A DGM/AGM/SRM who spots another team's lead (now
// org-wide visible — see 20260928000200_lead_org_wide_visibility.sql) and
// believes their own team could run it better raises a query here, with a
// justification. PMT triages it (see respond-lead-query): add the raiser
// to the lead's chat, decline it, or transfer the lead outright — this is
// the only way a lead ever gets transferred, there's no standalone/free
// transfer button. The raiser can edit/withdraw/remind on their own open
// query (see update-lead-query) — only one open query per lead at a time
// (from anyone, not just this caller — see the existingOpen check below),
// is why "Raise a Query" only shows again once it's resolved or withdrawn.
// Normally this never changes the lead itself — just opens a lead_queries
// row PMT can act on. The one exception: a query raised against a lead
// that's already md_approved reopens it to pmt_review (see below), so a
// disputed "Approved" lead doesn't just sit there unreviewed.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { getOrgWideHolders } from "../_shared/leadAuth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

// Same tier as everywhere else in this module that treats SRM like AGM.
const QUERY_RAISER_ROLES = ["dgm", "general_manager", "agm", "srm"];

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
      .select("id, lead_number, title, team, status")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    if (caller.teams.includes(lead.team)) {
      return jsonRes(req, 400, { error: "You're already on this lead's own team — raising a query is only for a lead outside your team(s)." });
    }

    const { data: existingOpen } = await adminClient
      .from("lead_queries")
      .select("id, raised_by_id, raised_by_team")
      .eq("lead_id", leadId)
      .eq("status", "open")
      .maybeSingle();
    if (existingOpen) {
      return jsonRes(req, 400, {
        error:
          existingOpen.raised_by_id === caller.id
            ? "You already have an open query on this lead — wait for PMT to respond, or edit/withdraw it."
            : `${existingOpen.raised_by_team} already has an open query on this lead — wait for PMT to respond, or ask them to withdraw/edit it.`,
      });
    }

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

    await logLeadActivity(adminClient, leadId, caller.id, caller.role, "cross_team_query_raised", null, null, `${caller.team}: ${justification}`);

    // A query raised against an already MD-approved lead reopens it to PMT
    // review — otherwise it would sit marked "Approved" with a dispute no
    // one's actively looking at. Every earlier stage's fields (PR, Reviewer,
    // Recommending Authority, documents, etc.) stay exactly as they were;
    // this only moves the status back one stage so PMT has to act on it
    // again, same as any other pmt_review lead (approve → MD, or decline).
    const wasApproved = lead.status === "md_approved";
    if (wasApproved) {
      const { error: reopenErr } = await adminClient.from("leads").update({ status: "pmt_review" }).eq("id", leadId);
      if (reopenErr) console.error("Reopening md_approved lead to pmt_review failed:", reopenErr.message);
      else await logLeadActivity(adminClient, leadId, caller.id, caller.role, "reopened_to_pmt", "md_approved", "pmt_review", `Reopened by ${caller.team}'s query: ${justification}`);
    }

    const pmtHolders = await getOrgWideHolders(adminClient, { committee: "PMT" });
    await notifyUsers(adminClient, pmtHolders, wasApproved
      ? {
          title: "Approved lead reopened — cross-team query raised",
          sub_text: `${lead.lead_number} — "${lead.title}" (${lead.team}) was already MD-approved and has been moved back to PMT review after a query from ${caller.team}. ${justification}`,
          type: "action_required",
          link: `/leads/${lead.id}`,
        }
      : {
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
