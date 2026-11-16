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
  pending_recommending_authority: "Pending Recommending Authority",
  pending_md: "Pending MD Approval",
  approved: "Approved",
  rejected: "Rejected",
};

export const FEE_NOTE_STATUS_VARIANTS = {
  draft: "neutral",
  pending_recommending_authority: "warning",
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
// (Person Responsible, Reviewer, and Recommending Authority/authorised
// signatory, who locks the proposal and records the client's outcome).
// Shared by LeadListPage/LeadDetailPage's row action and ProposalsListPage
// so the rule can't drift between entry points.
//
// The Accounts Committee can open a proposal too, but only ever sees ones
// whose Bid Payment Requisition Note the MD has approved (RLS returns no
// other rows to them), so seeing the row is enough here.
export function canOpenProposal(lead, profile) {
  if (!profile || !lead) return false;
  if (["md", "admin"].includes(profile.role)) return true;
  if ([lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(profile.id)) return true;
  return isAccountsCommittee(profile);
}

export function isAccountsCommittee(profile) {
  return profile?.accounts_committee === true;
}

// What still stands between a proposal and "Lock Proposal" — mirrored by
// lock-proposal's own server-side checks. Empty array = ready to lock.
export function lockBlockers({ proposal, feeNote, documents }) {
  const out = [];
  if (feeNote?.status !== "approved") out.push(`${FEE_NOTE_TITLE} approved by the MD`);
  if (!documents?.length) out.push("Proposal documents uploaded");
  if (proposal?.proposed_value == null) out.push("Proposed value entered in Financial");
  return out;
}

// ── EMD after the client's response (proposal_emd_tracking) ─────────
export const EMD_TRACK_LABELS = { refund: "EMD Refund", pbg: "Converted to PBG" };

export const EMD_STATUS_LABELS = {
  draft: "Draft",
  pending: "Refund Pending",
  received: "Refund Received",
  pending_accounts: "With Accounts",
  completed: "Completed",
};

export const EMD_STATUS_VARIANTS = {
  draft: "neutral",
  pending: "warning",
  received: "info",
  pending_accounts: "warning",
  completed: "success",
};

export const FINANCE_EVENT_LABELS = {
  payment_done: "Payment made by Accounts",
  refund_opened: "EMD refund opened",
  chose_refund: "Chose EMD Refund",
  chose_pbg: "Chose Converted to PBG",
  refund_received: "Marked refund received",
  refund_pending: "Marked refund pending",
  forwarded_to_accounts: "Forwarded to Accounts",
  refund_verified: "Accounts verified the EMD refund",
  pbg_processed: "Accounts processed the PBG",
  returned_by_accounts: "Sent back by Accounts",
};

// Proof uploads for payment / refund / PBG.
export const FINANCE_BUCKET = "proposal-finance";
export const FINANCE_FILE_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";
export const FINANCE_FILE_TYPES = /\.(pdf|docx?|jpe?g|png)$/i;

// A proposal is "effectively" locked either because someone locked it
// manually, or because the lead's own submission deadline has passed —
// mirrors the exact predicate the DB's can_edit_proposal() enforces server-
// side, so the UI never shows an action that the backend would reject.
export function isProposalLocked(proposal, lead) {
  if (proposal?.locked) return true;
  if (lead?.submission_deadline && new Date(lead.submission_deadline) < new Date()) return true;
  return false;
}
