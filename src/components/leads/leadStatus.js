// Shared lead-status display config — used by LeadListPage and
// LeadDetailPage so the label/color for a given status never drifts
// between the two.
export const STATUS_MAP = {
  pa_review: { label: "PA Review", variant: "warning" },
  dgm_initial_review: { label: "DGM Review", variant: "warning" },
  pmt_review: { label: "PMT Review", variant: "info" },
  pmt_extended_review: { label: "PMT Extended Review", variant: "info" },
  dgm_review: { label: "G3 Escalation Review", variant: "neutral" },
  md_review: { label: "MD Approval Pending", variant: "neutral" },
  pa_action_required: { label: "Action Required", variant: "danger" },
  pa_dropped: { label: "Dropped", variant: "danger" },
  md_approved: { label: "Approved by MD", variant: "success" },
  md_declined: { label: "Declined", variant: "danger" },
};

// The "happy path" stages shown in the workflow stepper — escalation
// (PMT Extended / the later G3 escalation review) and terminal/dropped
// states aren't drawn as fixed steps since they're conditional branches,
// not a fixed line.
export const STATUS_FLOW = [
  { key: "pa_review", label: "PA" },
  { key: "dgm_initial_review", label: "DGM" },
  { key: "pmt_review", label: "PMT" },
  { key: "md_review", label: "MD" },
];
