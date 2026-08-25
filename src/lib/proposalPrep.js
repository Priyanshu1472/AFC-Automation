// Shared constants/helpers for the Proposal Preparation module.

export const FEE_NOTE_TYPES = [
  { key: "emd", label: "EMD Note" },
  { key: "tender_fee", label: "Tender Fee Note" },
  { key: "pbg", label: "PBG Note" },
];

export const FEE_NOTE_LABELS = Object.fromEntries(FEE_NOTE_TYPES.map((t) => [t.key, t.label]));

export const FEE_NOTE_STATUS_LABELS = {
  draft: "Draft",
  pending_md: "Pending MD Approval",
  approved: "Approved",
  rejected: "Rejected",
};

export const FEE_NOTE_STATUS_VARIANTS = {
  draft: "neutral",
  pending_md: "warning",
  approved: "success",
  rejected: "danger",
};

export const PROPOSAL_DOCUMENT_TYPES = [
  { key: "technical", label: "Technical Proposal" },
  { key: "financial", label: "Financial Proposal" },
  { key: "proposal_3", label: "Proposal 3" },
];

export const CLIENT_RESPONSE_LABELS = {
  pending: "Pending",
  awarded: "Awarded",
  rejected: "Rejected",
};

export const CLIENT_RESPONSE_VARIANTS = {
  pending: "neutral",
  awarded: "success",
  rejected: "danger",
};

// Who gets "Open Proposal" — md/admin, or the lead's three assignees
// (Person Responsible, Reviewer, and Approval Authority/authorised
// signatory, who locks the proposal and records the client's outcome).
// Shared by LeadListPage/LeadDetailPage's row action and ProposalsListPage
// so the rule can't drift between entry points.
export function canOpenProposal(lead, profile) {
  if (!profile || !lead) return false;
  if (["md", "admin"].includes(profile.role)) return true;
  return [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id].includes(profile.id);
}

// A proposal is "effectively" locked either because someone locked it
// manually, or because the lead's own submission deadline has passed —
// mirrors the exact predicate the DB's can_edit_proposal() enforces server-
// side, so the UI never shows an action that the backend would reject.
export function isProposalLocked(proposal, lead) {
  if (proposal?.locked) return true;
  if (lead?.submission_deadline && new Date(lead.submission_deadline) < new Date()) return true;
  return false;
}
