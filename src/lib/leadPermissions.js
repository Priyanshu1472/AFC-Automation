import { LEAD_PA_TIER_ROLES, can } from "./roles";
import { isLeadOverdue, overdueEditorId } from "../components/leads/leadStatus";

// Lead-specific action predicates, mirroring the server-side authorization
// in advance-lead-stage/index.ts — UX-only (hide/disable), never trusted.
// Operate directly on the current user's afc_users profile (role/team/
// committee) — the same universal fields every other module uses, no
// separate role-assignment lookup. PMT is org-wide (spans all 4 teams, not
// one team apiece), so membership alone qualifies — no team match required.
export const leadCan = {
  // Every role can create a lead except MD and Admin.
  create: (profile) => !!profile?.role && profile.role !== "md" && profile.role !== "admin",
  // A lead an Associate Consultant/Project Assistant created without a
  // Person Responsible/Reviewer/Recommending Authority (see create-lead's
  // isPoRouted), or one PMT just transferred — either way, forwarded to one
  // specific named person (forwarded_to_id), who names all three,
  // PIN-confirmed, which then lands the lead in pa_review exactly like
  // every other creator's.
  poAssign: (profile, lead) => lead.status === "po_assignment" && !!profile?.id && profile.id === lead.forwarded_to_id,
  accept: (profile, lead) => lead.status === "pa_review" && profile?.id === lead.person_responsible_id,
  // A true drop, no reassignment. The creator has no Drop of their own —
  // only the Person Responsible, Reviewer, or Recommending Authority
  // actually named on the lead can drop it, at any non-terminal status,
  // md_approved included (server-side requires a written justification
  // there, see advance-lead-stage's "drop" case). Before any of those three
  // are named (po_assignment — a lead an AC/PA just created and forwarded,
  // not yet assigned), the person it was forwarded to stands in instead.
  drop: (profile, lead) => {
    if (["md_declined", "pa_dropped"].includes(lead.status)) return false;
    if (lead.status === "po_assignment") return !!profile?.id && profile.id === lead.forwarded_to_id;
    // The Recommending Authority sent this back for changes — only they
    // should re-review it, so there's no Withdraw here, only Edit &
    // Resubmit.
    if (lead.status === "pa_action_required" && lead.declined_from_status === "recommending_authority_review") return false;
    return !!profile?.id && [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(profile.id);
  },
  // The PR handing the lead to a teammate instead of dropping it — an
  // alternative to Drop, not exclusive with it.
  rejectReassign: (profile, lead) => lead.status === "pa_review" && profile?.id === lead.person_responsible_id,
  claim: (profile, lead) => lead.status === "pa_dropped" && LEAD_PA_TIER_ROLES.includes(profile?.role) && !!profile?.teams?.includes(lead.team),
  // A plain field edit — available before the PR has accepted (pa_review)
  // and again once returned for changes (pa_action_required); status never
  // changes as a result (see update-lead's own guarantee). Locked while
  // actively under Recommending Authority/PMT/MD review. Getting a declined
  // lead back into the approval pipeline is a separate, deliberate action —
  // the Lead Approval Note's Accept flow, not this edit.
  // A just-transferred lead (person_responsible_id null) can be picked up
  // and edited by anyone on its new team, not just the creator/PR — there
  // is no PR yet for that lead until someone fills the form (see
  // _shared/leadTransfer.ts).
  // Overdue (submission deadline passed): only the Person Responsible (or
  // the creator, if none is assigned yet — e.g. a po_assignment lead) can
  // edit, regardless of status — see advance-lead-stage's blanket guard
  // and update-lead's identical isOverdue branch.
  editResubmit: (profile, lead) =>
    isLeadOverdue(lead)
      ? profile?.id === overdueEditorId(lead)
      : (lead.status === "pa_review" || lead.status === "pa_action_required") &&
        (profile?.id === lead.created_by ||
          profile?.id === lead.person_responsible_id ||
          (!lead.person_responsible_id && !!profile?.teams?.includes(lead.team))),
  // The PR reviewing a creator-drafted Lead Approval Note (Accept/Edit/
  // Reject) before it can be submitted for Recommending Authority approval
  // — tracked via a flag, not a status, so the lead stays visibly
  // pa_review/pa_action_required the whole time (see advance-lead-stage's
  // pr_review_accept/pr_review_reject).
  prReviewAccept: (profile, lead) => !!lead.approval_note_pending_pr_review && profile?.id === lead.person_responsible_id,
  prReviewReject: (profile, lead) => !!lead.approval_note_pending_pr_review && profile?.id === lead.person_responsible_id,
  // The lead's actual first-line gate — gated on the exact named person
  // (leadRow.recommending_authority_id), not a role or team match. This is
  // what makes the chain work at offices with no DGM (e.g. Head Office).
  recommendingAuthorityReview: (profile, lead) => lead.status === "recommending_authority_review" && profile?.id === lead.recommending_authority_id,
  pmtReview: (profile, lead) => lead.status === "pmt_review" && profile?.committee === "PMT",
  mdReview: (profile, lead) => lead.status === "md_review" && profile?.role === "md",
  // A safety valve for editing the Business Partner after a lead has
  // already left pa_review — see advance-lead-stage's "withdraw_submission".
  withdrawSubmission: (profile, lead) =>
    ["recommending_authority_review", "pmt_review", "md_review"].includes(lead.status) &&
    (profile?.id === lead.created_by || profile?.id === lead.person_responsible_id),
};

// "My Leads" on LeadListPage — the leads the viewer is personally on the
// hook for: the assigned Person Responsible, the named Reviewer, or the
// named Recommending Authority. The creator is deliberately excluded — a
// lead you only created (and aren't otherwise named on) shows under "Team
// Leads", not here. handled-by-DGM and plain team ownership also stay on
// Team Leads.
export function isMyLead(profile, lead) {
  if (!profile) return false;
  return (
    profile.id === lead.person_responsible_id ||
    profile.id === lead.reviewer_id ||
    profile.id === lead.recommending_authority_id
  );
}

// "Team Leads" on LeadListPage — every lead going on in the viewer's own
// team(s), except for the roles now granted blanket org-wide visibility
// (md/cfo/cs/admin, and — per product decision — dgm/agm/srm and PMT
// committee members too, so a duplicate lead gets caught across teams
// instead of after two teams have both worked it; see
// 20260928000200_lead_org_wide_visibility.sql). This is where any of those
// roles get an org-wide browse view now that "My Leads" is personal-only
// for everyone.
export function isTeamLead(profile, lead) {
  if (!profile) return false;
  if (can.viewAllTeams(profile.role)) return true;
  if (["dgm", "general_manager", "agm", "srm"].includes(profile.role)) return true;
  if (profile.committee === "PMT") return true;
  return !!profile.teams?.includes(lead.team);
}

// "Action Required" on the Leads list — what counts as actionable depends
// on who's looking: a PMT member's action-required set is pmt_review leads
// (org-wide), a PA-tier user's is their own leads awaiting accept/drop or
// returned to them, etc. A user can match more than one (e.g. holds both a
// base role and a committee), so this unions every capacity that applies.
export function isActionRequiredForViewer(profile, lead) {
  return (
    leadCan.poAssign(profile, lead) ||
    leadCan.accept(profile, lead) ||
    (lead.status === "pa_action_required" && (profile?.id === lead.created_by || profile?.id === lead.person_responsible_id)) ||
    leadCan.prReviewAccept(profile, lead) ||
    leadCan.recommendingAuthorityReview(profile, lead) ||
    leadCan.pmtReview(profile, lead) ||
    leadCan.mdReview(profile, lead)
  );
}
