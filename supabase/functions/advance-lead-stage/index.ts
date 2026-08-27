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
import { Committee, PA_TIER_ROLES, addLeadChatParticipants, getOrgWideHolders, getTargetUser } from "../_shared/leadAuth.ts";
import { validateBusinessAssociate } from "../_shared/leadEligibility.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { LeadDocument, regenerateApprovalNote } from "../_shared/leadApprovalPdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const LEAD_DOCUMENTS_BUCKET = "lead-documents";

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
  approval_note_data: unknown;
  documents: LeadDocument[];
  chat_opened_at: string | null;
};

// (action name -> the committee it means "sent this lead on to MD") — used
// on md_decline to figure out which committee to send it back to, since
// all three routes converge on md_review and the lead row itself doesn't
// track which one it came through.
const MD_SOURCE_ACTIONS: Record<string, Committee> = {
  pmt_approve: "PMT",
  pmt_extended_approve: "PMT Extended",
  dgm_accept: "G3",
};

// Finds whichever committee most recently approved this lead into
// md_review, by walking the activity log rather than the lead row (which
// has no "how did this reach MD" column) — that's the committee md_decline
// sends it back to, alongside the creator/Person Responsible.
async function resolveCommitteeThatSentToMd(admin: AdminClient, leadId: string): Promise<Committee | null> {
  const { data, error } = await admin
    .from("lead_activity_log")
    .select("action, created_at")
    .eq("lead_id", leadId)
    .in("action", Object.keys(MD_SOURCE_ACTIONS))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return MD_SOURCE_ACTIONS[data.action as string] ?? null;
}

// Every action that stamps a fresh signature/remark onto the (still
// in-progress) Lead Approval Note — every committee approve/escalate/
// forward, but not declines (those just return to the assignee, nothing
// new to sign) and not md_approve (handled separately below, in "final"
// mode). "accept" is here too, but for a different reason: it's the one
// that flips the stored document from "-- Draft" to its final filename
// (see leadApprovalPdf.ts's isPreSubmission) the instant the lead actually
// leaves pa_review/pa_action_required — nothing else about the PDF changes
// at that step. Regeneration is best-effort and never blocks the actual
// decision.
const REGENERATE_DRAFT_NOTE_ON = new Set([
  "accept",
  "dgm_initial_approve",
  "pmt_approve", "pmt_escalate",
  "pmt_extended_approve", "pmt_extended_forward_dgm",
  "dgm_accept",
]);

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
  // md_decline is no longer terminal — it returns the lead to the creator/
  // PR for changes, same shape as every earlier-stage decline (see the
  // "md_decline" case for who gets notified and how resubmission routes
  // straight back to md_review, skipping every committee).
  md_review: { md_approve: "md_approved", md_decline: "pa_action_required", drop: "pa_dropped" },
  // "accept" also reaches pa_action_required -> dgm_initial_review — a
  // resubmission after DGM's decline follows the exact same
  // generate-note-then-accept procedure as the very first submission (see
  // the "accept" case, which further restricts this to only the
  // DGM-declined case via declined_from_status). Every other decline
  // source still resubmits through update-lead's plain Edit & Resubmit.
  pa_action_required: { drop: "pa_dropped", accept: "dgm_initial_review" },
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
    .select("id, lead_number, title, status, team, created_by, person_responsible_id, reviewer_id, approval_authority_id, handled_by_dgm_id, assigned_ba_id, declined_from_status, approval_note_data, documents, chat_opened_at")
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
    // Chat-roster bulk-adds to perform once the status update below actually
    // succeeds — never applied on a rejected/failed action. Each entry is a
    // whole committee (or the fixed named trio) added at once, not just
    // whoever acts — see addLeadChatParticipants.
    const chatRosterSyncs: { userIds: string[]; roleAtAdd: string }[] = [];
    // Storage objects to best-effort delete AFTER the status update below
    // succeeds — currently just the stale draft note removed on DGM decline
    // (see "dgm_initial_decline").
    let storageCleanupPaths: string[] = [];

    switch (action) {
      case "accept": {
        if (caller.id !== leadRow.person_responsible_id) return forbidden("Only the assigned Person Responsible can accept this lead.");
        // From pa_action_required, "accept" is only a valid resubmission
        // when DGM was the one who declined it — every other decline
        // source resubmits through update-lead instead (see the
        // LEAD_TRANSITIONS comment above).
        if (leadRow.status === "pa_action_required" && leadRow.declined_from_status !== "dgm_initial_review") {
          return jsonRes(req, 400, { error: "This lead wasn't returned by DGM — use Edit & Resubmit instead." });
        }
        // "Accept" is now "Submit for DGM Approval" on the Lead Approval
        // Note workflow — the note must exist (generated via
        // generate-lead-approval-note) before the lead can move on.
        if (!leadRow.approval_note_data) {
          return jsonRes(req, 400, { error: "Generate the Lead Approval Note before submitting for DGM approval." });
        }
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

      // New first-line DGM gate, ahead of PMT — this initial review is done
      // by the lead's own team's DGM (role + team match), NOT the org-wide
      // G3 committee pool. G3 only comes in later, if PMT Extended escalates
      // (see "dgm_accept"/"dgm_decline" further down).
      case "dgm_initial_approve": {
        if (caller.role !== "dgm" || caller.team !== leadRow.team) return forbidden("Only this lead's team DGM can act on this lead.");
        extraFields = { handled_by_dgm_id: caller.id };
        // Chat opens here — the first time this lead clears DGM and reaches
        // PMT — and only here; never overwritten on a later pass through
        // this same case (e.g. a resubmission), so it keeps the timestamp
        // of when it first opened.
        if (!leadRow.chat_opened_at) extraFields.chat_opened_at = new Date().toISOString();
        const pmtHolders = await getOrgWideHolders(adminClient, { committee: "PMT" });
        notifyTargetIds = pmtHolders;
        notifyTitle = "Lead awaiting PMT review";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was cleared by DGM. ${trimmedComment}`;
        chatRosterSyncs.push(
          { userIds: [leadRow.person_responsible_id, leadRow.reviewer_id, leadRow.approval_authority_id], roleAtAdd: "named" },
          { userIds: pmtHolders, roleAtAdd: "PMT" }
        );
        break;
      }

      case "dgm_initial_decline": {
        if (caller.role !== "dgm" || caller.team !== leadRow.team) return forbidden("Only this lead's team DGM can act on this lead.");
        // The stale draft note reflected the version DGM just rejected —
        // pull it off the lead immediately so nothing outdated is shown
        // while the Person Responsible reworks it; a fresh one is generated
        // (and reattached) the next time they submit the Lead Approval Note.
        const staleNote = (leadRow.documents || []).find((d) => d.category === "approval_note");
        const documentsWithoutNote = (leadRow.documents || []).filter((d) => d.category !== "approval_note");
        if (staleNote) storageCleanupPaths = [staleNote.path];
        extraFields = { handled_by_dgm_id: caller.id, declined_from_status: leadRow.status, documents: documentsWithoutNote };
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
        const mdHolders = await getOrgWideHolders(adminClient, { role: "md" });
        notifyTargetIds = mdHolders;
        notifyTitle = "Lead awaiting MD approval";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was cleared by PMT. ${trimmedComment}`;
        chatRosterSyncs.push({ userIds: mdHolders, roleAtAdd: "md" });
        break;
      }

      case "pmt_escalate": {
        if (caller.committee !== "PMT") return forbidden("Only a PMT committee member can act on this lead.");
        const pmtExtendedHolders = await getOrgWideHolders(adminClient, { committee: "PMT Extended" });
        notifyTargetIds = pmtExtendedHolders;
        notifyTitle = "Lead awaiting PMT Extended review";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was escalated by PMT for further review.`;
        chatRosterSyncs.push({ userIds: pmtExtendedHolders, roleAtAdd: "PMT Extended" });
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
        const mdHolders = await getOrgWideHolders(adminClient, { role: "md" });
        notifyTargetIds = mdHolders;
        notifyTitle = "Lead awaiting MD approval";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was cleared by PMT Extended. ${trimmedComment}`;
        chatRosterSyncs.push({ userIds: mdHolders, roleAtAdd: "md" });
        break;
      }

      case "pmt_extended_forward_dgm": {
        if (caller.committee !== "PMT Extended") return forbidden("Only a PMT Extended committee member can act on this lead.");
        const g3Holders = await getOrgWideHolders(adminClient, { committee: "G3" });
        notifyTargetIds = g3Holders;
        notifyTitle = "Lead awaiting DGM (G3) review";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was forwarded for DGM review.`;
        chatRosterSyncs.push({ userIds: g3Holders, roleAtAdd: "G3" });
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
        const mdHolders = await getOrgWideHolders(adminClient, { role: "md" });
        notifyTargetIds = mdHolders;
        notifyTitle = "Lead awaiting MD approval";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was accepted by DGM. ${trimmedComment}`;
        chatRosterSyncs.push({ userIds: mdHolders, roleAtAdd: "md" });
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
        extraFields = { declined_from_status: leadRow.status };
        const sendingCommittee = await resolveCommitteeThatSentToMd(adminClient, leadRow.id);
        const committeeHolders = sendingCommittee ? await getOrgWideHolders(adminClient, { committee: sendingCommittee }) : [];
        notifyTargetIds = [...new Set([leadRow.created_by, leadRow.person_responsible_id, ...committeeHolders])];
        notifyTitle = "Lead returned by MD";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was returned by the MD. Reason: ${trimmedComment}`;
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

    for (const sync of chatRosterSyncs) {
      await addLeadChatParticipants(adminClient, leadRow.id, sync.userIds, sync.roleAtAdd);
    }

    for (const path of storageCleanupPaths) {
      await adminClient.storage.from(LEAD_DOCUMENTS_BUCKET).remove([path]).catch(() => {});
    }

    // Stamps this stage's remark/signature onto the Lead Approval Note —
    // best-effort, after the activity row above so the note picks up the
    // remark that was just logged. A PDF hiccup here must never undo or
    // block the decision that already succeeded.
    if (REGENERATE_DRAFT_NOTE_ON.has(action)) {
      const result = await regenerateApprovalNote(adminClient, leadRow.id, "draft");
      if (!result.ok) console.error(`Approval Note regeneration failed for lead ${leadRow.id}:`, result.error);
    } else if (action === "md_approve") {
      const result = await regenerateApprovalNote(adminClient, leadRow.id, "final");
      if (!result.ok) console.error(`MD Approval Note generation failed for lead ${leadRow.id}:`, result.error);
    }

    if (notifyTargetIds.length) {
      await notifyUsers(adminClient, notifyTargetIds, {
        title: notifyTitle,
        sub_text: notifySubText,
        type: action === "md_approve" ? "info" : "action_required",
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
