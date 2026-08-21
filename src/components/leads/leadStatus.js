// Shared lead-status display config — used by LeadListPage and
// LeadDetailPage so the label/color for a given status never drifts
// between the two.
export const STATUS_MAP = {
  pa_review: { label: "PA Review", variant: "warning" },
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

// The DB values (online/offline/both) stay as-is — only the display text
// changed, from generic "Online"/"Offline" to what they actually mean here.
export const DELIVERY_TYPE_LABELS = {
  online: "Portal, Email",
  offline: "Hardcopy",
  both: "Both (Portal, Email & Hardcopy)",
};
