// src/lib/leadApprovalNote.js
// Preliminary Scrutiny by Office — fixed parameter list + default remarks,
// rendered as the page-2 table of the Lead Approval Note PDF. Only each
// lead's Yes/No + remarks are editable; the parameters themselves are not.
// Mirrored in supabase/functions/_shared/leadApprovalPdf.ts (SCRUTINY_PARAMETERS)
// — keep both in sync.

export const SCRUTINY_PARAMETERS = [
  { key: "financial_viability", label: "Financial Viability", defaultRemark: "Expected profitability considering bid cost, manpower, travel, taxes, etc." },
  { key: "commercial_feasibility", label: "Commercial Feasibility", defaultRemark: "Whether the estimated project value justifies the effort and investment." },
  { key: "eligibility_criteria", label: "Eligibility Criteria Fulfilled", defaultRemark: "Experience, turnover, certifications, staffing requirements, etc." },
  { key: "competition_assessment", label: "Competition Assessment", defaultRemark: "Limited/Moderate/High competition and expected chances of success." },
  { key: "client_relationship", label: "Client Relationship / Strategic Importance", defaultRemark: "Existing client, new client, repeat assignment, Government priority, etc." },
  { key: "legal_contractual_risks", label: "Legal/Contractual Risks", defaultRemark: "Any onerous clauses, penalties, liabilities, arbitration concerns, etc." },
  { key: "payment_terms", label: "Payment Terms Acceptable", defaultRemark: "Advance/payment milestones, retention money, delayed payments, etc." },
  { key: "risk_assessment", label: "Risk Assessment", defaultRemark: "Low / Medium / High with brief justification." },
];

export function defaultScrutinyEntries() {
  return SCRUTINY_PARAMETERS.map((p) => ({ yes_no: "Yes", remarks: p.defaultRemark }));
}
