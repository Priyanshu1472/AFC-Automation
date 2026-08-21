// supabase/functions/advance-lead-stage/index.ts
// JWT must be ON. Single dispatcher for every lead workflow transition —
// same rationale as advance-empanelment-stage: centralizes every
// authorization + status-precondition check in one reviewable place instead
// of one edge function per action. Authorization is derived from the
// caller's own afc_users.role/team/committee (from getCallerProfile — the
// universal role already assigned on the Users page, no separate
// role-assignment table) plus the lead's own assignment columns.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
import { PA_TIER_ROLES, getOrgWideHolders, getTargetUser } from "../_shared/leadAuth.ts";
import { validateBusinessAssociate } from "../_shared/leadEligibility.ts";
import { verifyActionPin } from "../_shared/pin.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

type LeadRow = {
  id: string;
  lead_number: string;
  title: string;
  status: string;
  team: string;
  created_by: string;
  person_responsible_id: string;
  reviewer_id: string;
  approval_authority_id: string;
  handled_by_dgm_id: string | null;
  assigned_ba_id: string | null;
  declined_from_status: string | null;
};

// (from_status -> action -> to_status) — the single source of truth for
// valid transitions, checked before any authorization logic runs.
const LEAD_TRANSITIONS: Record<string, Record<string, string>> = {
  // "drop" is the creator's own withdrawal — a true drop to pa_dropped,
  // valid at every non-terminal status, not just pa_review (see the "drop"
  // case for exactly who's allowed at each one). "reject_reassign" is
  // separate: the Person Responsible (when they aren't also the creator)
  // rejecting a pa_review lead hands it straight to a chosen teammate
  // instead of releasing it into an open pool, so it's a same-status
  // transition (see the "reject_reassign" case).
  // Accept now routes to DGM (G3) first, ahead of PMT — dgm_initial_review
  // is a distinct status from dgm_review (the PMT-Extended escalation
  // target further down), so the two don't collide in this map.
  pa_review: { accept: "dgm_initial_review", drop: "pa_dropped", reject_reassign: "pa_review" },
  dgm_initial_review: { dgm_initial_approve: "pmt_review", dgm_initial_decline: "pa_action_required", drop: "pa_dropped" },
  pa_dropped: { claim: "pa_review" },
  pmt_review: { pmt_approve: "md_review", pmt_escalate: "pmt_extended_review", pmt_decline: "pa_action_required", drop: "pa_dropped" },
  pmt_extended_review: { pmt_extended_approve: "md_review", pmt_extended_forward_dgm: "dgm_review", pmt_extended_decline: "pa_action_required", drop: "pa_dropped" },
  dgm_review: { dgm_accept: "md_review", dgm_decline: "pa_action_required", drop: "pa_dropped" },
  md_review: { md_approve: "md_approved", md_decline: "md_declined", drop: "pa_dropped" },
  pa_action_required: { drop: "pa_dropped" },
};

const REQUIRE_COMMENT = new Set([
  "dgm_initial_approve", "dgm_initial_decline",
  "pmt_approve", "pmt_escalate", "pmt_decline",
  "pmt_extended_approve", "pmt_extended_decline",
  "dgm_accept", "dgm_decline",
  "md_decline",
]);

// Every committee/MD decision requires the caller's own 5-digit action
// PIN — accept, approve, escalate/forward, decline, and drop, but never
// edit/resubmit, claim, or reject_reassign. dgm_initial_decline is the one
// explicit exception among the decision actions (product decision: DGM
// sending a lead back to the assignee doesn't need one).
const REQUIRE_PIN = new Set([
  "accept", "drop",
  "dgm_initial_approve",
  "pmt_approve", "pmt_escalate", "pmt_decline",
  "pmt_extended_approve", "pmt_extended_forward_dgm", "pmt_extended_decline",
  "dgm_accept", "dgm_decline",
  "md_approve", "md_decline",
]);

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

  const { lead_id, action, comment, pin } = body;
  if (!lead_id || typeof lead_id !== "string") return jsonRes(req, 400, { error: "lead_id is required." });
  if (!action || typeof action !== "string") return jsonRes(req, 400, { error: "action is required." });
  const trimmedComment = typeof comment === "string" ? comment.trim().slice(0, 2000) : "";

  const { data: lead, error: leadErr } = await adminClient
    .from("leads")
    .select("id, lead_number, title, status, team, created_by, person_responsible_id, reviewer_id, approval_authority_id, handled_by_dgm_id, assigned_ba_id, declined_from_status")
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });
  const leadRow = lead as LeadRow;

  const expectedTo = LEAD_TRANSITIONS[leadRow.status]?.[action];
  if (!expectedTo) {
    return jsonRes(req, 400, {
      error: `"${action}" is not valid for a lead in "${leadRow.status}" status. It may have just been updated by someone else — refresh and try again.`,
    });
  }
  if (REQUIRE_COMMENT.has(action) && !trimmedComment) {
    return jsonRes(req, 400, { error: "Comment/Description is required" });
  }
  // DGM sent this back for changes — only they should re-review it; no
  // Withdraw here so the assignee can't sidestep that by dropping it instead.
  if (action === "drop" && leadRow.status === "pa_action_required" && leadRow.declined_from_status === "dgm_initial_review") {
    return forbidden("This lead was returned by DGM and can only be edited and resubmitted — it can't be withdrawn here.");
  }

  function forbidden(msg: string) {
    return jsonRes(req, 403, { error: msg });
  }

  try {
    let extraFields: Record<string, unknown> = {};
    let notifyTargetIds: string[] = [];
    let notifyTitle = "";
    let notifySubText = "";

    switch (action) {
      case "accept": {
        if (caller.id !== leadRow.person_responsible_id) return forbidden("Only the assigned Person Responsible can accept this lead.");
        // A Business Associate is optional at creation, but required before
        // a lead can move on to PMT review — the Person Responsible picks
        // one here (or confirms the one already set) as part of accepting.
        if (!leadRow.assigned_ba_id) {
          const baId = typeof body.assigned_ba_id === "string" ? body.assigned_ba_id : "";
          if (!baId) return jsonRes(req, 400, { error: "Select a BA" });
          const baErr = await validateBusinessAssociate(adminClient, baId, leadRow.team);
          if (baErr) return jsonRes(req, 400, { error: baErr });
          extraFields = { assigned_ba_id: baId };
        }
        notifyTargetIds = await getOrgWideHolders(adminClient, { committee: "G3" });
        notifyTitle = "Lead awaiting DGM review";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was accepted and needs your review.`;
        break;
      }

      // A true drop, no reassignment involved. At pa_review, only the
      // creator can drop (whether or not they're also PR) — a non-creator
      // PR has no Drop here at all, only Accept/Reject; PR gains Drop once
      // they've actually accepted (pmt_review onward), never before. A
      // creator who assigned someone else keeps the right to withdraw at
      // every later, non-terminal stage regardless (per product decision:
      // the creator can always pull their own lead).
      case "drop": {
        const isCreator = caller.id === leadRow.created_by;
        const isPr = caller.id === leadRow.person_responsible_id;
        if (leadRow.status === "pa_review") {
          if (!isCreator) return forbidden("Only the lead's creator can drop this lead here — the assigned Person Responsible should Reject instead.");
          break;
        }
        if (leadRow.status === "pa_action_required") {
          if (!isCreator && !isPr) return forbidden("Only the lead's creator or Person Responsible can drop it.");
          break;
        }
        // Any later, already-escalated stage (pmt_review and beyond) — the
        // creator or the current Person Responsible (who has, by this
        // point, accepted the lead) can withdraw it.
        if (!isCreator && !isPr) return forbidden("Only the lead's creator or Person Responsible can withdraw this lead.");
        break;
      }

      // Rejecting before PMT review hands the lead straight to a chosen
      // teammate (not an open pool) — only reachable when the Person
      // Responsible isn't the creator (see "drop" above for that case).
      case "reject_reassign": {
        if (caller.id !== leadRow.person_responsible_id) return forbidden("Only the assigned Person Responsible can reject this lead.");
        if (caller.id === leadRow.created_by) return forbidden("Use Drop instead — you created this lead.");
        const reassignToId = typeof body.reassign_to_id === "string" ? body.reassign_to_id : "";
        if (!reassignToId) return jsonRes(req, 400, { error: "Select a team member to assign this lead to." });
        if (reassignToId === caller.id) return jsonRes(req, 400, { error: "Choose a different team member to reassign this lead to." });
        const target = await getTargetUser(adminClient, reassignToId);
        if (!target || !target.is_active || target.team !== leadRow.team || !PA_TIER_ROLES.includes(target.role)) {
          return jsonRes(req, 400, { error: "Selected user is not an eligible active team member." });
        }
        extraFields = { person_responsible_id: reassignToId };
        notifyTargetIds = [reassignToId];
        notifyTitle = "Lead assigned to you";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was reassigned to you for Accept/Reject.`;
        break;
      }

      case "claim": {
        if (!PA_TIER_ROLES.includes(caller.role) || caller.team !== leadRow.team) {
          return forbidden("You must be a PA, Project Officer, Associate Consultant, AGM, or SRM on this team to claim this lead.");
        }
        extraFields = { person_responsible_id: caller.id };
        break;
      }

      // New first-line DGM (G3) gate, ahead of PMT — same org-wide G3 pool
      // that also works the later PMT-Extended-escalated dgm_review stage.
      case "dgm_initial_approve": {
        if (caller.committee !== "G3") return forbidden("Only a G3 (DGM) committee member can act on this lead.");
        extraFields = { handled_by_dgm_id: caller.id };
        notifyTargetIds = await getOrgWideHolders(adminClient, { committee: "PMT" });
        notifyTitle = "Lead awaiting PMT review";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was cleared by DGM. ${trimmedComment}`;
        break;
      }

      case "dgm_initial_decline": {
        if (caller.committee !== "G3") return forbidden("Only a G3 (DGM) committee member can act on this lead.");
        extraFields = { handled_by_dgm_id: caller.id, declined_from_status: leadRow.status };
        notifyTargetIds = [leadRow.created_by, leadRow.person_responsible_id];
        notifyTitle = "Lead returned by DGM";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was returned. Reason: ${trimmedComment}`;
        break;
      }

      // PMT, PMT Extended, and G3 are all org-wide committees — each spans
      // all 4 teams, not one team apiece — so membership alone authorizes
      // the action, regardless of the lead's team or the member's own team.
      case "pmt_approve": {
        if (caller.committee !== "PMT") return forbidden("Only a PMT committee member can act on this lead.");
        notifyTargetIds = await getOrgWideHolders(adminClient, { role: "md" });
        notifyTitle = "Lead awaiting MD approval";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was cleared by PMT. ${trimmedComment}`;
        break;
      }

      case "pmt_escalate": {
        if (caller.committee !== "PMT") return forbidden("Only a PMT committee member can act on this lead.");
        notifyTargetIds = await getOrgWideHolders(adminClient, { committee: "PMT Extended" });
        notifyTitle = "Lead awaiting PMT Extended review";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was escalated by PMT for further review.`;
        break;
      }

      case "pmt_decline": {
        if (caller.committee !== "PMT") return forbidden("Only a PMT committee member can act on this lead.");
        extraFields = { declined_from_status: leadRow.status };
        notifyTargetIds = [leadRow.created_by, leadRow.person_responsible_id];
        notifyTitle = "Lead returned by PMT";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was returned. Reason: ${trimmedComment}`;
        break;
      }

      case "pmt_extended_approve": {
        if (caller.committee !== "PMT Extended") return forbidden("Only a PMT Extended committee member can act on this lead.");
        notifyTargetIds = await getOrgWideHolders(adminClient, { role: "md" });
        notifyTitle = "Lead awaiting MD approval";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was cleared by PMT Extended. ${trimmedComment}`;
        break;
      }

      case "pmt_extended_forward_dgm": {
        if (caller.committee !== "PMT Extended") return forbidden("Only a PMT Extended committee member can act on this lead.");
        notifyTargetIds = await getOrgWideHolders(adminClient, { committee: "G3" });
        notifyTitle = "Lead awaiting DGM (G3) review";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was forwarded for DGM review.`;
        break;
      }

      case "pmt_extended_decline": {
        if (caller.committee !== "PMT Extended") return forbidden("Only a PMT Extended committee member can act on this lead.");
        extraFields = { declined_from_status: leadRow.status };
        notifyTargetIds = [leadRow.created_by, leadRow.person_responsible_id];
        notifyTitle = "Lead returned by PMT Extended";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was returned. Reason: ${trimmedComment}`;
        break;
      }

      // G3 is the DGM committee — pooled org-wide across all 3 DGMs.
      // Membership grants DGM-equivalent permission regardless of the
      // member's own afc_users.role.
      case "dgm_accept": {
        if (caller.committee !== "G3") return forbidden("Only a G3 (DGM) committee member can act on this lead.");
        extraFields = { handled_by_dgm_id: caller.id };
        notifyTargetIds = await getOrgWideHolders(adminClient, { role: "md" });
        notifyTitle = "Lead awaiting MD approval";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was accepted by DGM. ${trimmedComment}`;
        break;
      }

      case "dgm_decline": {
        if (caller.committee !== "G3") return forbidden("Only a G3 (DGM) committee member can act on this lead.");
        extraFields = { handled_by_dgm_id: caller.id, declined_from_status: leadRow.status };
        notifyTargetIds = [leadRow.created_by, leadRow.person_responsible_id];
        notifyTitle = "Lead returned by DGM";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was returned. Reason: ${trimmedComment}`;
        break;
      }

      case "md_approve": {
        if (caller.role !== "md") return forbidden("Only the MD can act on this lead.");
        extraFields = { decided_at: new Date().toISOString() };
        notifyTargetIds = [leadRow.created_by, leadRow.person_responsible_id];
        notifyTitle = "Lead approved";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was approved by the MD.`;
        break;
      }

      case "md_decline": {
        if (caller.role !== "md") return forbidden("Only the MD can act on this lead.");
        extraFields = { decided_at: new Date().toISOString() };
        notifyTargetIds = [leadRow.created_by, leadRow.person_responsible_id];
        notifyTitle = "Lead declined";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was declined by the MD. Reason: ${trimmedComment}`;
        break;
      }

      default:
        return jsonRes(req, 400, { error: `Unknown action "${action}".` });
    }

    // PIN is the last gate, after every action-specific authorization check
    // above has already passed — a caller who isn't even allowed to take
    // this action gets that error, not a confusing "wrong PIN".
    if (REQUIRE_PIN.has(action)) {
      const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, pin);
      if (pinErr) return jsonRes(req, 400, { error: pinErr });
    }

    // Guarded on the same status the transitions map was checked against —
    // a concurrent second action naturally fails this filter (0 rows
    // matched) instead of racing the first one.
    const { data: updated, error: updateErr } = await adminClient
      .from("leads")
      .update({ status: expectedTo, ...extraFields })
      .eq("id", leadRow.id)
      .eq("status", leadRow.status)
      .select("id")
      .maybeSingle();

    if (updateErr || !updated) {
      return jsonRes(req, 400, {
        error: "This lead was just updated by someone else. Please refresh and try again.",
      });
    }

    await logLeadActivity(adminClient, leadRow.id, caller.id, caller.role, action, leadRow.status, expectedTo, trimmedComment || null);

    if (notifyTargetIds.length) {
      await notifyUsers(adminClient, notifyTargetIds, {
        title: notifyTitle,
        sub_text: notifySubText,
        type: action === "md_approve" || action === "md_decline" ? "info" : "action_required",
        link: `/leads/${leadRow.id}`,
      });
    }

    return jsonRes(req, 200, { success: true, status: expectedTo });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
