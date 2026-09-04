import { LEAD_PA_TIER_ROLES } from "./roles";

// Lead-specific action predicates, mirroring the server-side authorization
// in advance-lead-stage/index.ts — UX-only (hide/disable), never trusted.
// Operate directly on the current user's afc_users profile (role/team/
// committee) — the same universal fields every other module uses, no
// separate role-assignment lookup. PMT/PMT Extended/G3 are all org-wide
// committees (each spans all 4 teams, not one team apiece), so membership
// alone qualifies — no team match required.
export const leadCan = {
  // Every role can create a lead except MD and Admin.
  create: (profile) => !!profile?.role && profile.role !== "md" && profile.role !== "admin",
  accept: (profile, lead) => lead.status === "pa_review" && profile?.id === lead.person_responsible_id,
  // A true drop, no reassignment. At pa_review, only the creator can drop
  // (whether or not they're also PR) — a non-creator PR has no Drop here at
  // all, only Accept/Reject; PR gains Drop once they've actually accepted
  // (pmt_review onward), never before. Creator or PR at every other
  // non-terminal status.
  drop: (profile, lead) => {
    if (["md_approved", "md_declined", "pa_dropped"].includes(lead.status)) return false;
    if (lead.status === "pa_review") return profile?.id === lead.created_by;
    // DGM sent this back for changes — only they should re-review it, so
    // there's no Withdraw here, only Edit & Resubmit.
    if (lead.status === "pa_action_required" && lead.declined_from_status === "dgm_initial_review") return false;
    return profile?.id === lead.created_by || profile?.id === lead.person_responsible_id;
  },
  // The PR rejecting a lead they didn't create — hands it to a teammate
  // instead of dropping it.
  rejectReassign: (profile, lead) =>
    lead.status === "pa_review" && profile?.id === lead.person_responsible_id && profile?.id !== lead.created_by,
  claim: (profile, lead) => lead.status === "pa_dropped" && LEAD_PA_TIER_ROLES.includes(profile?.role) && !!profile?.teams?.includes(lead.team),
  // A plain field edit — available before the PR has accepted (pa_review)
  // and again once returned for changes (pa_action_required); status never
  // changes as a result (see update-lead's own guarantee). Locked while
  // actively under DGM/PMT/PMT Extended/G3/MD review. Getting a declined
  // lead back into the approval pipeline is a separate, deliberate action —
  // the Lead Approval Note's Accept flow, not this edit.
  editResubmit: (profile, lead) =>
    (lead.status === "pa_review" || lead.status === "pa_action_required") &&
    (profile?.id === lead.created_by || profile?.id === lead.person_responsible_id),
  // The PR reviewing a creator-drafted Lead Approval Note (Accept/Edit/
  // Reject) before it can be submitted for DGM approval — tracked via a
  // flag, not a status, so the lead stays visibly pa_review/
  // pa_action_required the whole time (see advance-lead-stage's
  // pr_review_accept/pr_review_reject).
  prReviewAccept: (profile, lead) => !!lead.approval_note_pending_pr_review && profile?.id === lead.person_responsible_id,
  prReviewReject: (profile, lead) => !!lead.approval_note_pending_pr_review && profile?.id === lead.person_responsible_id,
  // First-line DGM gate, ahead of PMT — this is the lead's own team's DGM
  // specifically (team membership), NOT the org-wide G3 committee pool that
  // the later PMT-Extended-escalated dgmReview below uses. G3 org-wide
  // access only starts once a lead actually reaches the committee pipeline
  // (pmt_review onward) — mirrors can_view_lead()'s own exclusion of this
  // status from its org-wide committee clause.
  dgmInitialReview: (profile, lead) => lead.status === "dgm_initial_review" && profile?.role === "dgm" && !!profile?.teams?.includes(lead.team),
  pmtReview: (profile, lead) => lead.status === "pmt_review" && profile?.committee === "PMT",
  pmtExtendedReview: (profile, lead) => lead.status === "pmt_extended_review" && profile?.committee === "PMT Extended",
  dgmReview: (profile, lead) => lead.status === "dgm_review" && profile?.committee === "G3",
  mdReview: (profile, lead) => lead.status === "md_review" && profile?.role === "md",
};

// "Action Required" on the Leads list — what counts as actionable depends
// on who's looking: a PMT member's action-required set is pmt_review leads
// (org-wide), a PA-tier user's is their own leads awaiting accept/drop or
// returned to them, etc. A user can match more than one (e.g. holds both a
// base role and a committee), so this unions every capacity that applies.
export function isActionRequiredForViewer(profile, lead) {
  return (
    leadCan.accept(profile, lead) ||
    (lead.status === "pa_action_required" && (profile?.id === lead.created_by || profile?.id === lead.person_responsible_id)) ||
    leadCan.prReviewAccept(profile, lead) ||
    leadCan.dgmInitialReview(profile, lead) ||
    leadCan.pmtReview(profile, lead) ||
    leadCan.pmtExtendedReview(profile, lead) ||
    leadCan.dgmReview(profile, lead) ||
    leadCan.mdReview(profile, lead)
  );
}
