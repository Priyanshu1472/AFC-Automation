// supabase/functions/escalate-lead-to-g3/index.ts
// JWT must be ON. PMT's second option at pmt_review, alongside pmt_approve
// (see advance-lead-stage) — escalates a lead, together with at least one
// other org-wide conflicting lead (any stage, any team — e.g. two teams
// independently chasing the same opportunity), to the G3 committee for MD
// to pick a winner among. A separate function rather than another
// advance-lead-stage case: that dispatcher updates exactly one lead row
// per call, but this one has to move every member lead (the one PMT was
// reviewing + every conflict pick) into g3_review at once.
//
// assigned_g3_ids is always required (at least one) — an escalation with
// nobody to resolve it isn't a real escalation. conflict_lead_ids is
// normally required too, EXCEPT when this call is resolving a cross-team
// query (optional query_id in the body, see raise-lead-query/
// respond-lead-query): a DGM flagging another team's lead doesn't
// necessarily know of a second, specific conflicting lead to pick, so PMT
// can forward straight to G3 on the query alone. When query_id is given,
// it must belong to this lead and still be open; on success the query is
// marked escalated_to_g3 and its raiser notified.
//
// The primary lead (the one PMT is actually reviewing) must be pmt_review
// — this action only ever appears on that lead's own action panel. A
// conflict pick can be at any non-terminal, already-assigned stage
// (INELIGIBLE_CONFLICT_STATUSES below is the exclusion list) — unlike the
// primary lead, it doesn't have to be at pmt_review itself. Each member's
// status right before joining is snapshotted onto its
// lead_g3_escalation_members row (previous_status) so resolve-g3-escalation
// knows where the accepted lead should resume: straight to md_review if it
// had already cleared Recommending Authority (previous_status pmt_review
// or md_review), otherwise restored to exactly where it was. That
// snapshot-and-restore also means a lead can never be double-escalated —
// once it's g3_review, it fails this same eligibility check for any other
// escalation until this one resolves.
//
// Visibility is scoped to exactly the G3 members PMT selects (assigned_g3_
// ids), not every G3 committee member org-wide — see
// 20261103000000_lead_g3_escalation_assignees.sql. Every member lead also
// becomes viewable (can_view_lead) by those same assignees, so they can
// actually open each conflicting lead's own page, not just this summary —
// see 20261104000000_g3_assignee_lead_visibility.sql.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
import { addLeadChatParticipants, getOrgWideHolders } from "../_shared/leadAuth.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { regenerateApprovalNote } from "../_shared/leadApprovalPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const INELIGIBLE_CONFLICT_STATUSES = new Set(["po_assignment", "g3_review", "md_approved", "md_declined", "pa_dropped"]);

type LeadRow = {
  id: string;
  lead_number: string;
  title: string;
  team: string;
  status: string;
  chat_opened_at: string | null;
  created_by: string;
  person_responsible_id: string;
};

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  if (caller.committee !== "PMT") return jsonRes(req, 403, { error: "Only a PMT committee member can escalate a lead to G3." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
  if (!leadId) return jsonRes(req, 400, { error: "lead_id is required." });
  const queryId = typeof body.query_id === "string" ? body.query_id : "";
  const conflictLeadIds = [...new Set(
    Array.isArray(body.conflict_lead_ids)
      ? body.conflict_lead_ids.filter((id): id is string => typeof id === "string" && id !== leadId)
      : []
  )];
  if (!conflictLeadIds.length && !queryId) return jsonRes(req, 400, { error: "Select at least one conflicting lead to escalate to G3." });
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
  if (!comment) return jsonRes(req, 400, { error: "Remarks are required to escalate a lead to G3." });
  const assignedG3Ids = [...new Set(
    Array.isArray(body.assigned_g3_ids) ? body.assigned_g3_ids.filter((id): id is string => typeof id === "string") : []
  )];
  if (!assignedG3Ids.length) return jsonRes(req, 400, { error: "Select at least one G3 committee member to escalate to." });

  try {
    const { data: memberLeads, error: leadsErr } = await adminClient
      .from("leads")
      .select("id, lead_number, title, team, status, chat_opened_at, created_by, person_responsible_id")
      .in("id", [leadId, ...conflictLeadIds]);
    if (leadsErr) return jsonRes(req, 500, { error: "Failed to load leads." });

    const primaryLead = (memberLeads || []).find((l: LeadRow) => l.id === leadId);
    if (!primaryLead) return jsonRes(req, 404, { error: "Lead not found." });
    if (primaryLead.status !== "pmt_review") return jsonRes(req, 400, { error: "This lead isn't at PMT review anymore." });

    for (const conflictId of conflictLeadIds) {
      const row = (memberLeads || []).find((l: LeadRow) => l.id === conflictId);
      if (!row) return jsonRes(req, 404, { error: "One of the selected conflicting leads could not be found." });
      if (INELIGIBLE_CONFLICT_STATUSES.has(row.status)) {
        return jsonRes(req, 400, { error: `${row.lead_number} isn't eligible for a G3 conflict right now — it may already be finished, unassigned, or part of another escalation.` });
      }
    }

    let query: { id: string; lead_id: string; raised_by_id: string; raised_by_team: string } | null = null;
    if (queryId) {
      const { data: queryRow, error: queryErr } = await adminClient
        .from("lead_queries")
        .select("id, lead_id, raised_by_id, raised_by_team, status")
        .eq("id", queryId)
        .maybeSingle();
      if (queryErr || !queryRow) return jsonRes(req, 404, { error: "Query not found." });
      if (queryRow.lead_id !== leadId) return jsonRes(req, 400, { error: "That query isn't on this lead." });
      if (queryRow.status !== "open" && queryRow.status !== "added_to_chat") {
        return jsonRes(req, 400, { error: `This query is already "${queryRow.status}".` });
      }
      query = queryRow;
    }

    const { data: g3Users, error: g3Err } = await adminClient
      .from("afc_users")
      .select("id")
      .in("id", assignedG3Ids)
      .eq("committee", "G3")
      .eq("is_active", true);
    if (g3Err) return jsonRes(req, 500, { error: "Failed to validate the selected G3 members." });
    if ((g3Users || []).length !== assignedG3Ids.length) {
      return jsonRes(req, 400, { error: "One or more selected G3 members are no longer valid." });
    }

    const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
    if (pinErr) return jsonRes(req, 400, { error: pinErr });

    const members = memberLeads as LeadRow[];

    const { data: escalation, error: escErr } = await adminClient
      .from("lead_g3_escalations")
      .insert({ raised_lead_id: leadId, raised_by_id: caller.id, pmt_comment: comment })
      .select("id")
      .single();
    if (escErr || !escalation) return jsonRes(req, 500, { error: "Failed to create the G3 escalation." });

    const { error: membersErr } = await adminClient
      .from("lead_g3_escalation_members")
      .insert(members.map((l) => ({ escalation_id: escalation.id, lead_id: l.id, previous_status: l.status })));
    if (membersErr) return jsonRes(req, 500, { error: "Failed to record the escalation's leads." });

    const { error: assigneesErr } = await adminClient
      .from("lead_g3_escalation_assignees")
      .insert(assignedG3Ids.map((user_id) => ({ escalation_id: escalation.id, user_id })));
    if (assigneesErr) return jsonRes(req, 500, { error: "Failed to record the escalation's G3 assignees." });

    const mdHolders = await getOrgWideHolders(adminClient, { role: "md" });
    const pmtHolders = await getOrgWideHolders(adminClient, { committee: "PMT" });

    for (const lead of members) {
      const isPrimary = lead.id === leadId;

      // Each member's own previous status is the guard here, not a single
      // shared one — conflict picks can be at any eligible stage.
      const { error: updateErr } = await adminClient
        .from("leads")
        .update({ status: "g3_review" })
        .eq("id", lead.id)
        .eq("status", lead.status);
      if (updateErr) {
        console.error(`Failed to move lead ${lead.id} to g3_review:`, updateErr.message);
        continue;
      }

      await logLeadActivity(
        adminClient,
        lead.id,
        caller.id,
        caller.role,
        "pmt_escalate_g3",
        lead.status,
        "g3_review",
        isPrimary ? comment : `Flagged as a conflicting lead for the G3 escalation of ${primaryLead.lead_number} — "${primaryLead.title}".`
      );

      // Chat roster: PMT loses access to every member lead's chat the
      // moment it's escalated; G3 and MD gain it. Reuses the existing
      // per-lead lead_chat_participants table/RLS (is_lead_chat_participant,
      // can_view_lead_chat) unchanged — no new chat-visibility branching.
      if (pmtHolders.length) {
        await adminClient.from("lead_chat_participants").delete().eq("lead_id", lead.id).in("user_id", pmtHolders);
      }
      await addLeadChatParticipants(adminClient, lead.id, assignedG3Ids, "g3");
      await addLeadChatParticipants(adminClient, lead.id, mdHolders, "md");

      if (lead.chat_opened_at) {
        // A system announcement, not a message from the PMT caller —
        // null sender_id renders as "AFC Bot" (see LeadChatPanel.jsx) and
        // is sensible anyway, since the caller is removed from this very
        // chat a few lines above and would otherwise show as "Unknown".
        const { error: msgErr } = await adminClient.from("lead_chat_messages").insert({
          lead_id: lead.id,
          sender_id: null,
          message: isPrimary
            ? `This lead has been escalated to the G3 committee for conflict review. PMT no longer has access to this chat.`
            : `This lead has been flagged as conflicting with ${primaryLead.lead_number} and escalated to the G3 committee for review. PMT no longer has access to this chat.`,
        });
        if (msgErr) console.error("G3 escalation chat announcement failed:", msgErr.message);
      }
    }

    const result = await regenerateApprovalNote(adminClient, leadId, "draft");
    if (!result.ok) console.error(`Approval Note regeneration failed for lead ${leadId}:`, result.error);

    if (query) {
      const { error: queryUpdateErr } = await adminClient
        .from("lead_queries")
        .update({ status: "escalated_to_g3", pmt_response: comment, resolved_by_id: caller.id, resolved_by_role: "pmt", resolved_at: new Date().toISOString() })
        .eq("id", query.id)
        .in("status", ["open", "added_to_chat"]);
      if (queryUpdateErr) console.error("Failed to mark lead_queries row escalated_to_g3:", queryUpdateErr.message);
      await notifyUsers(adminClient, [query.raised_by_id], {
        title: "Your query was escalated to G3",
        sub_text: `PMT forwarded ${primaryLead.lead_number} — "${primaryLead.title}" to the G3 committee for conflict review.`,
        type: "info",
        link: `/leads/${leadId}`,
      });
    }

    const leadLabel = `${primaryLead.lead_number} — "${primaryLead.title}"`;
    await notifyUsers(adminClient, [...assignedG3Ids, ...mdHolders], {
      title: "Lead escalated to G3 for conflict review",
      sub_text: `PMT escalated ${leadLabel}${conflictLeadIds.length ? ` along with ${conflictLeadIds.length} conflicting lead${conflictLeadIds.length > 1 ? "s" : ""}` : ""}. ${comment}`,
      type: "action_required",
      link: `/leads/${leadId}`,
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
