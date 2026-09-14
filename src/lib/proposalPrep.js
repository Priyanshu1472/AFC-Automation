// Shared constants/helpers for the Proposal Preparation module.

// The Bid Payment Requisition Note is one note per proposal carrying any
// combination of these three fee lines. EMD is refundable; the other two
// are not. `financialKey` is the matching figure on the lead's own Lead
// Approval Note (approval_note_data.financial_requirement) each line
// pre-fills from.
export const FEE_LINES = [
  { key: "emd", label: "EMD", altLabel: "Bid Security", refundable: true, financialKey: "emd" },
  { key: "tender_fee", label: "Tender Fee", altLabel: "Document Fee", refundable: false, financialKey: "document_fee" },
  { key: "processing_fee", label: "Processing Fee", altLabel: "Bid Processing Fee", refundable: false, financialKey: "processing_fee" },
];

export const FEE_NOTE_TITLE = "Bid Payment Requisition Note";

export const BORNE_BY_LABELS = { afc: "AFC", bp: "Business Partner" };

export const FEE_NOTE_STATUS_LABELS = {
  draft: "Draft",
  pending_approval_authority: "Pending Approval Authority",
  pending_md: "Pending MD Approval",
  approved: "Approved",
  rejected: "Rejected",
};

export const FEE_NOTE_STATUS_VARIANTS = {
  draft: "neutral",
  pending_approval_authority: "warning",
  pending_md: "warning",
  approved: "success",
  rejected: "danger",
};

export const PAYMENT_MODE_LABELS = {
  online: "Online",
  bank_guarantee: "Bank Guarantee",
  demand_draft: "Demand Draft",
  bankers_cheque: "Banker's Cheque",
  fixed_deposit_receipt: "Fixed Deposit Receipt",
};

// Payment mode, and the DD/instrument payee details, are picked per fee
// line (EMD, Tender Fee, Processing Fee) — not once for the whole note —
// since each can genuinely be paid a different way.
const DD_LIKE_MODES = new Set(["demand_draft", "bank_guarantee", "bankers_cheque", "fixed_deposit_receipt"]);
export function needsPayeeDetails(paymentMode) {
  return DD_LIKE_MODES.has(paymentMode);
}

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
