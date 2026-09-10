// Shared lead-status display config — used by LeadListPage and
// LeadDetailPage so the label/color for a given status never drifts
// between the two.
export const STATUS_MAP = {
  pa_review: { label: "PR Review", variant: "warning" },
  dgm_initial_review: { label: "DGM", variant: "warning" },
  pmt_review: { label: "PMT", variant: "info" },
  pmt_extended_review: { label: "PMT Extended", variant: "info" },
  dgm_review: { label: "G3", variant: "neutral" },
  md_review: { label: "Pending", variant: "neutral" },
  pa_action_required: { label: "Action Required", variant: "danger" },
  pa_dropped: { label: "Dropped", variant: "danger" },
  md_approved: { label: "Approved", variant: "success" },
  md_declined: { label: "Declined", variant: "danger" },
};

// The full possible pipeline, in order — including the two escalation
// branches (PMT Extended, G3) inline rather than as conditional
// side-branches, so a lead currently sitting in either one still gets a
// full stepper instead of it disappearing entirely (STATUS_FLOW.findIndex
// returning -1 used to hide the whole card). A lead that took the direct
// path (skipping PMT Extended/G3) will show those two as "done" once it's
// past them — a minor imprecision, but the alternative (the stepper
// vanishing on an escalated lead) was the actual complaint this fixes.
export const STATUS_FLOW = [
  { key: "pa_review", label: "PA" },
  { key: "dgm_initial_review", label: "DGM" },
  { key: "pmt_review", label: "PMT" },
  { key: "pmt_extended_review", label: "PMT Extended" },
  { key: "dgm_review", label: "G3" },
  { key: "md_review", label: "MD" },
];

// Where DGM's initial-review approval actually sends a resubmitted lead —
// mirrors advance-lead-stage's RESUME_AFTER_DECLINE. A lead declined after
// PMT's own first look resumes directly at whichever stage sent it back
// (skipping committees that already cleared it), so the button label on
// LeadDetailPage should say where it's really going, not always "→ PMT".
const RESUME_AFTER_DECLINE_LABEL = {
  pmt_extended_review: "PMT Extended",
  dgm_review: "G3",
  md_review: "MD",
};

export function dgmInitialApproveLabel(declinedFromStatus) {
  const target = declinedFromStatus ? RESUME_AFTER_DECLINE_LABEL[declinedFromStatus] : undefined;
  return `Approve → ${target || "PMT"}`;
}

// Each committee's own actionable stage — used to scope LeadListPage's
// per-committee tab to only that committee's own leads (not the whole
// post-DGM pipeline: can_view_lead() grants a committee member org-wide
// read access to every later stage too, but a PMT Extended member's own tab
// should only ever show leads actually at pmt_extended_review, never ones
// still sitting with PMT or already forwarded to G3/MD).
export const COMMITTEE_STAGE_STATUS = {
  PMT: "pmt_review",
  "PMT Extended": "pmt_extended_review",
  G3: "dgm_review",
};

// The DB values (online/offline/both) stay as-is — only the display text
// changed, from generic "Online"/"Offline" to what they actually mean here.
export const DELIVERY_TYPE_LABELS = {
  online: "Online",
  offline: "Hardcopy",
  both: "Both (Online & Hardcopy)",
};
