// supabase/functions/_shared/empanelmentFields.ts
// Canonical registry of fields/documents a reviewer can raise a compliance
// flag against. Shared between raise-empanelment-hold (validates the
// field_key a reviewer submits) and submit-empanelment-correction (rejects
// any corrected field that isn't actually flagged).

export const FLAGGABLE_TEXT_FIELDS: Record<string, string> = {
  org_name: "Organisation Name",
  entity_type: "Entity Type",
  year_established: "Year of Establishment",
  cin: "CIN",
  reg_address: "Registered Office Address",
  branch_address: "Branch Office Address",
  contact_person: "Contact Person Name",
  designation: "Designation",
  phone: "Phone Number",
  email: "Official Email ID",
  website: "Website",
  pan: "PAN Number",
  gst: "GST Registration Number",
  msme_no: "MSME Registration No.",
  companies_act_status: "Compliance under Companies Act",
  company_status: "Status of the Company",
  date_of_incorporation: "Date of Incorporation",
  last_bs_filed: "Date of Last Balance Sheet Filed",
  authorised_capital: "Authorised Capital",
  paidup_capital: "Paid-up Capital",
  director_kyc: "Director / Partner Details and KYC",
  working_capital_ratio: "Working Capital Ratio",
  ca_firm_name: "CA Firm Name",
  ca_reg_no: "CA Firm Registration Number",
  core_expertise: "Core Areas of Expertise",
  team_size: "Number of Employees / Team Size",
  years_experience: "Years of Relevant Experience",
  certifications: "ISO or Other Quality Certifications",
  govt_empanelments: "Empanelment with Other Government / Donor Agencies",
  bank_name: "Bank Name",
  bank_branch: "Branch Name / Address",
  account_number: "Account Number",
  ifsc_code: "IFSC Code",
};

export const FLAGGABLE_DOCUMENT_SLOTS: Record<string, string> = {
  panCopy: "PAN Card Copy",
  incorporationCert: "Certificate of Incorporation / MOA / AOA",
  gstCert: "GST Registration Certificate",
  nonBlacklisting: "Notarized Declaration of Non-Blacklisting",
  mcaCompliance: "MCA Legal Compliance Printout",
  financials: "Audited Financial Statements",
  netWorthCert: "CA Certified Net Worth Statement",
  isoCert: "ISO / Other Quality Certifications",
  cancelledCheque: "Cancelled Cheque / Bank Passbook",
  workOrders: "Work Orders / Completion Certificates",
};

// field_key namespace: plain column name ("pan") for text fields, or
// "doc:<slot>" ("doc:gstCert") for a document slot.
export function isValidFieldKey(fieldKey: string): boolean {
  if (fieldKey.startsWith("doc:")) return fieldKey.slice(4) in FLAGGABLE_DOCUMENT_SLOTS;
  return fieldKey in FLAGGABLE_TEXT_FIELDS;
}

export function labelForFieldKey(fieldKey: string): string {
  if (fieldKey.startsWith("doc:")) return FLAGGABLE_DOCUMENT_SLOTS[fieldKey.slice(4)] || fieldKey;
  return FLAGGABLE_TEXT_FIELDS[fieldKey] || fieldKey;
}
