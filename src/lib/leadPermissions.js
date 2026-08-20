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
    return profile?.id === lead.created_by || profile?.id === lead.person_responsible_id;
  },
  // The PR rejecting a lead they didn't create — hands it to a teammate
  // instead of dropping it.
  rejectReassign: (profile, lead) =>
    lead.status === "pa_review" && profile?.id === lead.person_responsible_id && profile?.id !== lead.created_by,
  claim: (profile, lead) => lead.status === "pa_dropped" && LEAD_PA_TIER_ROLES.includes(profile?.role) && profile?.team === lead.team,
  // Edit is available before the PR has accepted (pa_review, in place — no
  // status change) and again once returned for changes (pa_action_required,
  // Edit & Resubmit back into pmt_review). Locked while actively under
  // PMT/PMT Extended/G3/MD review.
  editResubmit: (profile, lead) =>
    (lead.status === "pa_review" || lead.status === "pa_action_required") &&
    (profile?.id === lead.created_by || profile?.id === lead.person_responsible_id),
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
    leadCan.pmtReview(profile, lead) ||
    leadCan.pmtExtendedReview(profile, lead) ||
    leadCan.dgmReview(profile, lead) ||
    leadCan.mdReview(profile, lead)
  );
}
