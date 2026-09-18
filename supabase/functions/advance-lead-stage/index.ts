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
import { createAdminClient, getCallerProfile, isCallerOnTeam } from "../_shared/auth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
import { PA_TIER_ROLES, addLeadChatParticipants, getOrgWideHolders, getTargetUser } from "../_shared/leadAuth.ts";
import { validateBusinessAssociate, validateAssignment, validateReviewer, validateRecommendingAuthority } from "../_shared/leadEligibility.ts";
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
  recommending_authority_id: string;
  handled_by_dgm_id: string | null;
  assigned_ba_id: string | null;
  declined_from_status: string | null;
  approval_note_data: unknown;
  approval_note_pr_reviewed: boolean;
  approval_note_pending_pr_review: boolean;
  documents: LeadDocument[];
  chat_opened_at: string | null;
  submission_deadline: string | null;
};

// A finished lead never goes "overdue" — mirrors leadStatus.js's identical
// TERMINAL_STATUSES on the frontend.
const TERMINAL_STATUSES = new Set(["md_approved", "md_declined", "pa_dropped"]);

// Every action that stamps a fresh signature/remark onto the (still
// in-progress) Lead Approval Note — every committee approve, but not
// declines (those just return to the assignee, nothing new to sign) and
// not md_approve (handled separately below, in "final" mode). "accept" is
// here too, but for a different reason: it's the one that flips the stored
// document from "-- Draft" to its final filename (see leadApprovalPdf.ts's
// isPreSubmission) the instant the lead actually leaves pa_review/
// pa_action_required — nothing else about the PDF changes at that step.
// Regeneration is best-effort and never blocks the actual decision.
const REGENERATE_DRAFT_NOTE_ON = new Set([
  "accept",
  // The PR taking ownership of a creator-drafted note — regenerates
  // immediately so the PDF picks up their now-eligible signature (see
  // approval_note_pr_reviewed / regenerateApprovalNoteInner).
  "pr_review_accept",
  "ra_approve",
  "pmt_approve",
  // Reverts the stored document back to its "-- Draft" filename now that
  // the lead is back at pa_review and editable again.
  "withdraw_submission",
]);

// Where a resubmitted lead resumes once the Recommending Authority
// re-approves it (ra_approve), keyed by declined_from_status — only when
// the decline happened AFTER pmt_review's own first look (i.e. only MD),
// so PMT isn't made to re-review something it already cleared. A
// first-ever submission (no decline yet), or one declined by the
// Recommending Authority/PMT themselves, has nothing to skip and falls
// through to the normal pmt_review target — see the "ra_approve" case,
// which is the only place this is consulted.
const RESUME_AFTER_DECLINE: Record<string, string> = {
  md_review: "md_review",
};

// Per resume target, who to notify/chat-add and what to call it — mirrors
// the equivalent per-stage cases further down (ra_approve's normal PMT
// path) so a skip-ahead resubmission notifies the same audience that
// stage's own transition would.
async function resumeNotification(
  admin: AdminClient,
  target: string
): Promise<{ title: string; holders: string[]; roleAtAdd: string }> {
  if (target === "md_review") {
    return { title: "Lead awaiting MD approval", holders: await getOrgWideHolders(admin, { role: "md" }), roleAtAdd: "md" };
  }
  return { title: "Lead awaiting PMT review", holders: await getOrgWideHolders(admin, { committee: "PMT" }), roleAtAdd: "PMT" };
}

// (from_status -> action -> to_status) — the single source of truth for
// valid transitions, checked before any authorization logic runs.
const LEAD_TRANSITIONS: Record<string, Record<string, string>> = {
  // No Person Responsible/Reviewer/Recommending Authority set yet — either a
  // lead created by an Associate Consultant/Project Assistant (see
  // create-lead's isPoRouted) or one just transferred to this team (see
  // _shared/leadTransfer.ts, which lands a lead here too). "po_assign" is
  // the team's Project Officer (or Area Manager/Regional Manager) naming
  // all three, PIN-confirmed — the lead then lands in pa_review, exactly
  // where every other creator's lead already starts. "drop" here is the
  // creator withdrawing it before a PO ever acts, same as pa_review's
  // creator-only drop (see the "drop" case).
  po_assignment: { po_assign: "pa_review", drop: "pa_dropped" },
  // "drop" is the creator's own withdrawal — a true drop to pa_dropped,
  // valid at every non-terminal status, not just pa_review (see the "drop"
  // case for exactly who's allowed at each one). "reject_reassign" is
  // separate: the Person Responsible (when they aren't also the creator)
  // rejecting a pa_review lead hands it straight to a chosen teammate
  // instead of releasing it into an open pool, so it's a same-status
  // transition (see the "reject_reassign" case).
  // Accept routes to the Recommending Authority first, ahead of PMT.
  // submit_for_pr_review / pr_review_accept / pr_review_reject are all
  // same-status transitions, same idea as reject_reassign above — the PR
  // review of a creator-drafted note is tracked entirely via the
  // approval_note_pending_pr_review / approval_note_pr_reviewed flags on
  // the lead row (see their case bodies below), never a status change, so
  // the lead stays visibly "PA Review" (or "Action Required") the whole
  // time it's cycling through creator-drafts -> PR-reviews -> Accept/Edit/
  // Reject.
  pa_review: {
    accept: "recommending_authority_review", drop: "pa_dropped", reject_reassign: "pa_review",
    submit_for_pr_review: "pa_review", pr_review_accept: "pa_review", pr_review_reject: "pa_review",
  },
  recommending_authority_review: {
    ra_approve: "pmt_review", ra_decline: "pa_action_required", drop: "pa_dropped",
    withdraw_submission: "pa_review",
  },
  pa_dropped: { claim: "pa_review" },
  pmt_review: {
    pmt_approve: "md_review", pmt_decline: "pa_action_required", drop: "pa_dropped",
    withdraw_submission: "pa_review",
  },
  // md_decline is no longer terminal — it returns the lead to the creator/
  // PR for changes, same shape as every earlier-stage decline (see the
  // "md_decline" case for who gets notified).
  md_review: {
    md_approve: "md_approved", md_decline: "pa_action_required", drop: "pa_dropped",
    withdraw_submission: "pa_review",
  },
  // The one action still available once a lead is fully approved — the
  // creator or Person Responsible withdrawing it after the fact (see the
  // "drop" case for the extra written-justification requirement this one
  // stage adds on top of the usual PIN gate).
  md_approved: { drop: "pa_dropped" },
  // "accept" also reaches pa_action_required -> recommending_authority_
  // review — every decline source (Recommending Authority, PMT, MD)
  // resubmits through the exact same generate-note-then-accept procedure
  // as the very first submission (see the "accept" case): edit the Lead
  // Approval Note, then send it back through the Recommending Authority
  // again, never skipping ahead to whichever stage declined it (RESUME_
  // AFTER_DECLINE handles the one case — an MD decline — where PMT
  // shouldn't be made to re-review). update-lead's own separate
  // pa_action_required resubmit path (a "straight back to the declining
  // stage" shortcut) is no longer reachable through the normal UI flow,
  // which always routes here instead.
  pa_action_required: {
    drop: "pa_dropped", accept: "recommending_authority_review",
    submit_for_pr_review: "pa_action_required", pr_review_accept: "pa_action_required", pr_review_reject: "pa_action_required",
  },
};

const REQUIRE_COMMENT = new Set([
  "ra_approve", "ra_decline",
  "pmt_approve", "pmt_decline",
  "md_decline",
  "pr_review_reject",
  "withdraw_submission",
]);

// Every committee/MD decision requires the caller's own 5-digit action
// PIN — accept, approve, decline, drop, and withdraw, but never
// edit/resubmit, claim, or reject_reassign. ra_decline is the one explicit
// exception among the decision actions (product decision: the
// Recommending Authority sending a lead back to the assignee doesn't need
// one — carried over from the old dgm_initial_decline exception).
const REQUIRE_PIN = new Set([
  "accept", "drop", "po_assign",
  "ra_approve",
  "pmt_approve", "pmt_decline",
  "md_approve", "md_decline",
  "withdraw_submission",
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
    .select("id, lead_number, title, status, team, created_by, person_responsible_id, reviewer_id, recommending_authority_id, handled_by_dgm_id, assigned_ba_id, declined_from_status, approval_note_data, approval_note_pr_reviewed, approval_note_pending_pr_review, documents, chat_opened_at, submission_deadline")
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });
  const leadRow = lead as LeadRow;

  // Every action is blocked once the submission deadline has passed — the
  // only way forward is the Person Responsible (or the creator, if none is
  // assigned yet, e.g. a po_assignment lead) editing the lead via
  // update-lead to push the date into the future, which silently
  // reactivates whatever status it's frozen at.
  if (!TERMINAL_STATUSES.has(leadRow.status) && leadRow.submission_deadline && new Date(leadRow.submission_deadline) < new Date()) {
    return jsonRes(req, 403, {
      error: "This lead's submission deadline has passed. Only the Person Responsible (or the creator, if none is assigned yet) can edit it to update the date — no other action is available until then.",
    });
  }

  let expectedTo = LEAD_TRANSITIONS[leadRow.status]?.[action];
  if (!expectedTo) {
    return jsonRes(req, 400, {
      error: `"${action}" is not valid for a lead in "${leadRow.status}" status. It may have just been updated by someone else — refresh and try again.`,
    });
  }
  if (REQUIRE_COMMENT.has(action) && !trimmedComment) {
    return jsonRes(req, 400, { error: "Comment/Description is required" });
  }
  // Recommending Authority sent this back for changes — only they should
  // re-review it; no Withdraw here so the assignee can't sidestep that by
  // dropping it instead.
  if (action === "drop" && leadRow.status === "pa_action_required" && leadRow.declined_from_status === "recommending_authority_review") {
    return forbidden("This lead was returned by the Recommending Authority and can only be edited and resubmitted — it can't be withdrawn here.");
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
    // succeeds — currently just the stale draft note removed on Recommending
    // Authority decline (see "ra_decline").
    let storageCleanupPaths: string[] = [];

    switch (action) {
      // The team's Project Officer (or Area Manager/Regional Manager, same
      // permission tier) naming Person Responsible/Reviewer/Recommending
      // Authority on a lead an Associate Consultant/Project Assistant
      // created without them (see create-lead's isPoRouted) — re-applies
      // the exact same eligibility checks create-lead itself would have run
      // had the creator been allowed to set these directly.
      case "po_assign": {
        if (!["project_officer", "area_manager", "regional_manager"].includes(caller.role) || !isCallerOnTeam(caller, leadRow.team)) {
          return forbidden("You must be a Project Officer, Area Manager, or Regional Manager on this team to assign this lead.");
        }
        const prId = typeof body.person_responsible_id === "string" ? body.person_responsible_id : "";
        const reviewerId = typeof body.reviewer_id === "string" ? body.reviewer_id : "";
        const raId = typeof body.recommending_authority_id === "string" ? body.recommending_authority_id : "";
        if (!prId || !reviewerId || !raId) {
          return jsonRes(req, 400, { error: "Person Responsible, Reviewer, and Recommending Authority are all required." });
        }
        const assignErr = await validateAssignment(adminClient, prId, leadRow.team);
        if (assignErr) return jsonRes(req, 400, { error: assignErr });
        const reviewerErr = await validateReviewer(adminClient, reviewerId, leadRow.team);
        if (reviewerErr) return jsonRes(req, 400, { error: reviewerErr });
        const authorityErr = await validateRecommendingAuthority(adminClient, raId, leadRow.team);
        if (authorityErr) return jsonRes(req, 400, { error: authorityErr });
        extraFields = { person_responsible_id: prId, reviewer_id: reviewerId, recommending_authority_id: raId };
        // Chat opens here — this is the first moment a po_assignment lead
        // (freshly created via create-lead's isPoRouted, or landed here by
        // a transfer — see _shared/leadTransfer.ts) actually has a Person
        // Responsible/Reviewer/Recommending Authority to chat with.
        if (!leadRow.chat_opened_at) extraFields.chat_opened_at = new Date().toISOString();
        notifyTargetIds = [prId, reviewerId, raId].filter((uid) => uid !== caller.id);
        notifyTitle = "Lead assigned to you";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" has named you as Person Responsible, Reviewer, or Recommending Authority.`;
        chatRosterSyncs.push({ userIds: [leadRow.created_by, prId, reviewerId, raId], roleAtAdd: "named" });
        break;
      }

      case "accept": {
        if (caller.id !== leadRow.person_responsible_id) return forbidden("Only the assigned Person Responsible can accept this lead.");
        // From pa_action_required, "accept" resubmits through the
        // Recommending Authority again — regardless of which stage
        // (Recommending Authority, PMT, or MD) declined it. Every
        // pa_action_required lead already has a Lead Approval Note that's
        // been stamped with committee remarks, so resubmission always means
        // editing that note and sending it back through the full committee
        // chain, not skipping ahead to whichever stage declined it.
        // "Accept" is now "Submit for Recommending Authority Approval" on
        // the Lead Approval Note workflow — the note must exist (generated
        // via generate-lead-approval-note) before the lead can move on.
        if (!leadRow.approval_note_data) {
          return jsonRes(req, 400, { error: "Generate the Lead Approval Note before submitting for approval." });
        }
        // The PR submitting is itself the strongest possible review signal
        // — always true here regardless of whether they got here via the
        // explicit pr_review_accept button first (e.g. a PR who lands
        // straight on the preview page and submits a note that's still
        // technically "pending" their review — see generate-lead-approval-
        // note's pending-review guard for why that's otherwise blocked).
        extraFields = { approval_note_pr_reviewed: true, approval_note_pending_pr_review: false };
        // A Business Partner is optional here too, same as at creation — if
        // none is picked, the note prints "Yet to be Decided" and it stays
        // open to a later choice once the PR edits the lead again (only
        // possible at pa_review/pa_action_required — see leadEligibility's
        // BA lock). Only actually validate/set it if one was submitted.
        if (!leadRow.assigned_ba_id) {
          const baId = typeof body.assigned_ba_id === "string" ? body.assigned_ba_id : "";
          if (baId) {
            const baErr = await validateBusinessAssociate(adminClient, baId, leadRow.team);
            if (baErr) return jsonRes(req, 400, { error: baErr });
            extraFields.assigned_ba_id = baId;
          }
        }
        // The named Recommending Authority is the sole actor at the next
        // stage (see "ra_approve" below) — only they need to be notified.
        notifyTargetIds = [leadRow.recommending_authority_id];
        notifyTitle = "Lead awaiting your review";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was accepted and needs your review as Recommending Authority.`;
        break;
      }

      // The creator (never the PR — they'd just Accept straight through)
      // filled the Lead Approval Note and is sending it to the PR for
      // review before it can go to the Recommending Authority. Same-status
      // transition — the lead stays exactly where it is (pa_review or
      // pa_action_required); only approval_note_pending_pr_review flips on,
      // which is what drives the Draft label and the PR's Accept/Edit/
      // Reject prompt on the lead page.
      case "submit_for_pr_review": {
        if (caller.id === leadRow.person_responsible_id) {
          return forbidden("You're the Person Responsible — submit for DGM approval directly instead.");
        }
        if (caller.id !== leadRow.created_by) return forbidden("Only the lead's creator can send it for Person Responsible review.");
        if (!leadRow.approval_note_data) {
          return jsonRes(req, 400, { error: "Generate the Lead Approval Note before sending it for review." });
        }
        if (leadRow.approval_note_pending_pr_review) {
          return jsonRes(req, 400, { error: "This note is already awaiting the Person Responsible's review." });
        }
        extraFields = { approval_note_pending_pr_review: true };
        notifyTargetIds = [leadRow.person_responsible_id];
        notifyTitle = "Lead Approval Note awaiting your review";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was drafted and needs your Accept/Edit/Reject.`;
        break;
      }

      // The PR reviewing a creator-drafted note — LeadDetailPage's Accept
      // and Edit buttons both call this action directly (identical
      // transition, they only differ in where the client navigates
      // afterward: straight to DGM submission, or into the form to edit
      // first). Either way the PR is now the reviewer of record, so their
      // signature becomes eligible on the PDF (approval_note_pr_reviewed,
      // regenerated immediately via REGENERATE_DRAFT_NOTE_ON above), and
      // there's nothing left pending their review.
      case "pr_review_accept": {
        if (caller.id !== leadRow.person_responsible_id) return forbidden("Only the assigned Person Responsible can review this lead's note.");
        if (!leadRow.approval_note_pending_pr_review) return jsonRes(req, 400, { error: "There's no draft awaiting your review." });
        extraFields = { approval_note_pr_reviewed: true, approval_note_pending_pr_review: false };
        notifyTargetIds = [leadRow.created_by];
        notifyTitle = "Lead Approval Note reviewed";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was reviewed by the Person Responsible and is on its way to the Recommending Authority.`;
        break;
      }

      // Bounces the draft back to the creator to rework — same idea as
      // ra_decline, just one stage earlier, by the PR instead of the
      // Recommending Authority, and without a status change: the creator sees the ordinary
      // Edit/"Send for Person Responsible Review" flow again the moment
      // approval_note_pending_pr_review clears, no separate resubmit path
      // needed.
      case "pr_review_reject": {
        if (caller.id !== leadRow.person_responsible_id) return forbidden("Only the assigned Person Responsible can review this lead's note.");
        if (!leadRow.approval_note_pending_pr_review) return jsonRes(req, 400, { error: "There's no draft awaiting your review." });
        extraFields = { approval_note_pending_pr_review: false };
        notifyTargetIds = [leadRow.created_by];
        notifyTitle = "Lead Approval Note returned";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was returned by the Person Responsible. Reason: ${trimmedComment}`;
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
        // No Person Responsible yet at po_assignment — same creator-only
        // rule as pa_review.
        if (leadRow.status === "po_assignment" || leadRow.status === "pa_review") {
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
        // Withdrawing a lead the MD has already approved is a bigger deal
        // than dropping it at any earlier stage — require a written
        // justification here specifically; every other stage's drop keeps
        // comment optional, unchanged.
        if (leadRow.status === "md_approved" && !trimmedComment) {
          return jsonRes(req, 400, { error: "A justification is required to drop an approved lead." });
        }
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
        if (!PA_TIER_ROLES.includes(caller.role) || !isCallerOnTeam(caller, leadRow.team)) {
          return forbidden("You must be a PA, Project Officer, Associate Consultant, AGM, or SRM on this team to claim this lead.");
        }
        extraFields = { person_responsible_id: caller.id };
        break;
      }

      // Recommending Authority review — the lead's actual first-line gate.
      // Gated on the exact person named on the lead (leadRow.
      // recommending_authority_id), not a role or team match — this is what
      // makes the chain work at offices with no DGM (e.g. Head Office),
      // since the named person can just as well be an AGM/SRM there.
      case "ra_approve": {
        if (caller.id !== leadRow.recommending_authority_id) return forbidden("Only this lead's named Recommending Authority can act on this lead.");
        // Resubmitting after a decline resumes at whichever stage originally
        // sent it back, skipping committees that already cleared it — e.g.
        // an MD decline goes straight back to MD, not through PMT again. A
        // first-ever submission, or one declined by the Recommending
        // Authority/PMT themselves, has nothing to skip — normal pmt_review
        // path.
        const resumeTarget = leadRow.declined_from_status ? RESUME_AFTER_DECLINE[leadRow.declined_from_status] : undefined;
        if (resumeTarget) expectedTo = resumeTarget;
        // Consumed — a future decline (from wherever it happens next) sets
        // this fresh; it shouldn't keep steering approvals after this point.
        extraFields = { handled_by_dgm_id: caller.id, declined_from_status: null };
        // Chat has normally already opened by now — at create-lead (a
        // direct, non-isPoRouted creation) or at "po_assign" above — but
        // this guard is the fallback for any lead that somehow reached here
        // without it (legacy data, edge cases). Never overwritten on a
        // later pass through this same case (e.g. a resubmission), so it
        // keeps the timestamp of when it first opened.
        if (!leadRow.chat_opened_at) extraFields.chat_opened_at = new Date().toISOString();
        const resumeInfo = await resumeNotification(adminClient, expectedTo);
        notifyTargetIds = resumeInfo.holders;
        notifyTitle = resumeInfo.title;
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was cleared by the Recommending Authority. ${trimmedComment}`;
        chatRosterSyncs.push(
          { userIds: [leadRow.person_responsible_id, leadRow.reviewer_id, leadRow.recommending_authority_id], roleAtAdd: "named" },
          { userIds: resumeInfo.holders, roleAtAdd: resumeInfo.roleAtAdd }
        );
        break;
      }

      case "ra_decline": {
        if (caller.id !== leadRow.recommending_authority_id) return forbidden("Only this lead's named Recommending Authority can act on this lead.");
        // The stale draft note reflected the version the Recommending
        // Authority just rejected — pull it off the lead immediately so
        // nothing outdated is shown while the Person Responsible reworks
        // it; a fresh one is generated (and reattached) the next time they
        // submit the Lead Approval Note.
        const staleNote = (leadRow.documents || []).find((d) => d.category === "approval_note");
        const documentsWithoutNote = (leadRow.documents || []).filter((d) => d.category !== "approval_note");
        if (staleNote) storageCleanupPaths = [staleNote.path];
        extraFields = { handled_by_dgm_id: caller.id, declined_from_status: leadRow.status, documents: documentsWithoutNote };
        notifyTargetIds = [leadRow.created_by, leadRow.person_responsible_id];
        notifyTitle = "Lead returned by Recommending Authority";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was returned. Reason: ${trimmedComment}`;
        break;
      }

      // PMT is org-wide — spans every team, not one team apiece — so
      // membership alone authorizes the action, regardless of the lead's
      // team or the member's own team.
      case "pmt_approve": {
        if (caller.committee !== "PMT") return forbidden("Only a PMT committee member can act on this lead.");
        const mdHolders = await getOrgWideHolders(adminClient, { role: "md" });
        notifyTargetIds = mdHolders;
        notifyTitle = "Lead awaiting MD approval";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was cleared by PMT. ${trimmedComment}`;
        chatRosterSyncs.push({ userIds: mdHolders, roleAtAdd: "md" });
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
        // PMT is the only committee that ever sends a lead to MD now — no
        // need to walk the activity log to figure out which one did.
        const pmtHolders = await getOrgWideHolders(adminClient, { committee: "PMT" });
        notifyTargetIds = [...new Set([leadRow.created_by, leadRow.person_responsible_id, ...pmtHolders])];
        notifyTitle = "Lead returned by MD";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was returned by the MD. Reason: ${trimmedComment}`;
        break;
      }

      // A safety valve for the one thing nothing else lets the PR fix once
      // a lead has actually been forwarded: the Business Partner. BA is
      // locked from the moment a lead leaves pa_review/pa_action_required
      // (see leadEligibility) — if it needs to change after that, the
      // submission has to come back to pa_review first. Available to the
      // creator/PR at every "in flight" stage short of MD's final decision;
      // resubmitting afterward (accept) always restarts at recommending_
      // authority_review, same as any other decline, so nothing downstream
      // is treated as still-valid once BA might have changed.
      case "withdraw_submission": {
        if (caller.id !== leadRow.created_by && caller.id !== leadRow.person_responsible_id) {
          return forbidden("Only the lead's creator or Person Responsible can withdraw this submission.");
        }
        extraFields = { declined_from_status: null, approval_note_pr_reviewed: false, approval_note_pending_pr_review: false };
        const pmtHolders = await getOrgWideHolders(adminClient, { committee: "PMT" });
        const mdHolders = await getOrgWideHolders(adminClient, { role: "md" });
        notifyTargetIds = [...new Set([...pmtHolders, ...mdHolders])];
        notifyTitle = "Lead submission withdrawn";
        notifySubText = `${leadRow.lead_number} — "${leadRow.title}" was withdrawn by ${caller.id === leadRow.created_by ? "its creator" : "the Person Responsible"} for changes. Reason: ${trimmedComment}`;
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
