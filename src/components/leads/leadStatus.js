// Shared lead-status display config — used by LeadListPage and
// LeadDetailPage so the label/color for a given status never drifts
// between the two.
export const STATUS_MAP = {
  pa_review: { label: "PR Review", variant: "warning" },
  recommending_authority_review: { label: "Recommending Authority", variant: "warning" },
  pmt_review: { label: "PMT", variant: "info" },
  md_review: { label: "Pending", variant: "neutral" },
  pa_action_required: { label: "Action Required", variant: "danger" },
  pa_dropped: { label: "Dropped", variant: "danger" },
  md_approved: { label: "Approved", variant: "success" },
  md_declined: { label: "Declined", variant: "danger" },
};

// The full possible pipeline, in order.
export const STATUS_FLOW = [
  { key: "pa_review", label: "PA" },
  { key: "recommending_authority_review", label: "Recommending Authority" },
  { key: "pmt_review", label: "PMT" },
  { key: "md_review", label: "MD" },
];

// Where the Recommending Authority's approval actually sends a resubmitted
// lead — mirrors advance-lead-stage's RESUME_AFTER_DECLINE. A lead declined
// by MD (i.e. after PMT's own first look) resumes directly at MD, skipping
// PMT since it already cleared, so the button label on LeadDetailPage
// should say where it's really going, not always "→ PMT".
const RESUME_AFTER_DECLINE_LABEL = {
  md_review: "MD",
};

export function raApproveLabel(declinedFromStatus) {
  const target = declinedFromStatus ? RESUME_AFTER_DECLINE_LABEL[declinedFromStatus] : undefined;
  return `Approve → ${target || "PMT"}`;
}

// PMT's own actionable stage — used to scope LeadListPage's committee tab
// to only PMT's own leads (not the whole pipeline: can_view_lead() grants
// PMT org-wide read access to every lead now, but its own tab should only
// ever show leads actually at pmt_review).
export const COMMITTEE_STAGE_STATUS = {
  PMT: "pmt_review",
};

// The DB values (online/offline/both) stay as-is — only the display text
// changed, from generic "Online"/"Offline" to what they actually mean here.
export const DELIVERY_TYPE_LABELS = {
  online: "Online",
  offline: "Hardcopy",
  both: "Both (Online & Hardcopy)",
};
