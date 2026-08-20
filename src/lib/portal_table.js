// Shared data/constants for the Lead Generation module — ported from the
// previous AFC app's src/modules/afc/leadFormParts.jsx. Text normalization
// here is kept only for the live client-side preview; the actual duplicate
// score is computed server-side by the find_similar_leads RPC so it can't
// be spoofed (see supabase/migrations/20260811000000_lead_generation_schema.sql,
// afc_norm_lead_text / afc_lead_tokens — keep the stopword list in sync).

export const PORTALS = [
  { name: "GeM (Government e-Marketplace)", category: "Central Govt", identifier: "Bid No. (GeM)" },
  { name: "CPPP (Central Public Procurement Portal)", category: "Central Govt", identifier: "Tender ID" },
  { name: "IREPS (Indian Railways)", category: "Central Govt", identifier: "Tender No." },
  { name: "MSTC e-Procurement", category: "Central Govt", identifier: "Tender No." },
  { name: "BHEL e-Procurement", category: "Central Govt", identifier: "Tender Ref. No." },
  { name: "NTPC e-Procurement", category: "Central Govt", identifier: "Tender No." },
  { name: "ONGC e-Procurement", category: "Central Govt", identifier: "Tender No." },
  { name: "Coal India e-Procurement", category: "Central Govt", identifier: "NIT No." },
  { name: "NABARD e-Procurement", category: "Central Govt", identifier: "Tender No." },
  { name: "NITI Aayog / DPIIT Portal", category: "Central Govt", identifier: "Ref. / RFP No." },
  { name: "NSDC (National Skill Development Corp.)", category: "Central Govt", identifier: "Tender / RFP No." },
  { name: "MoRD (Ministry of Rural Development)", category: "Central Govt", identifier: "Tender No." },
  { name: "Only NRLMs Portal", category: "Central Govt", identifier: "Tender No." },
  { name: "NHAI e-Procurement", category: "Central Govt", identifier: "Tender No." },
  { name: "NHIDCL e-Procurement", category: "Central Govt", identifier: "Tender No." },
  { name: "RITES e-Procurement", category: "Central Govt", identifier: "Tender No." },
  { name: "NBCC e-Procurement", category: "Central Govt", identifier: "Tender No." },
  { name: "CPWD e-Procurement", category: "Central Govt", identifier: "NIT No." },
  { name: "AIIMS Tenders", category: "Central Govt", identifier: "Tender No." },
  { name: "DRDO e-Procurement", category: "Central Govt", identifier: "Tender No." },
  { name: "MoEF&CC Tenders", category: "Central Govt", identifier: "Tender No." },
  { name: "SIDBI e-Procurement", category: "Central Govt", identifier: "RFP No." },
  { name: "Delhi e-Tendering", category: "State Govt", identifier: "NIT / Tender No." },
  { name: "Maharashtra MahaTenders", category: "State Govt", identifier: "Tender No." },
  { name: "UP eTender", category: "State Govt", identifier: "Tender No." },
  { name: "Karnataka eProcurement", category: "State Govt", identifier: "Tender No." },
  { name: "Tamil Nadu Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Gujarat Tender", category: "State Govt", identifier: "Tender No." },
  { name: "Rajasthan eProcurement", category: "State Govt", identifier: "Tender No." },
  { name: "Madhya Pradesh Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Himachal Pradesh Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Uttarakhand Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Punjab eProcurement", category: "State Govt", identifier: "Tender No." },
  { name: "Haryana eProcurement", category: "State Govt", identifier: "Tender No." },
  { name: "Bihar eProcurement", category: "State Govt", identifier: "Tender No." },
  { name: "Odisha Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Jharkhand Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Chhattisgarh eProcurement", category: "State Govt", identifier: "Tender No." },
  { name: "West Bengal Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Assam Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Kerala Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Andhra Pradesh eProcurement", category: "State Govt", identifier: "Tender No." },
  { name: "Telangana Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Goa Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "J&K Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Meghalaya Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Manipur Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Tripura Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Nagaland Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Mizoram Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Arunachal Pradesh Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Sikkim Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Puducherry Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Chandigarh Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "Ladakh Tenders", category: "State Govt", identifier: "Tender No." },
  { name: "World Bank Projects (worldbank.org)", category: "International", identifier: "Project ID" },
  { name: "ADB Projects (adb.org)", category: "International", identifier: "Project No." },
  { name: "UNDP Procurement (undp.org)", category: "International", identifier: "RFP / ITB No." },
  { name: "UN Global Marketplace (ungm.org)", category: "International", identifier: "UNGM Ref. No." },
  { name: "GIZ (Deutsche Gesellschaft)", category: "International", identifier: "Tender Ref." },
  { name: "JICA Projects", category: "International", identifier: "Project / Bid No." },
  { name: "USAID Procurement", category: "International", identifier: "Solicitation No." },
  { name: "KfW Development Bank", category: "International", identifier: "Bid / RFP No." },
  { name: "IsDB (Islamic Dev. Bank)", category: "International", identifier: "IFB / RFP No." },
  { name: "NDB (New Dev. Bank)", category: "International", identifier: "Project / Bid No." },
  { name: "AIIB Projects", category: "International", identifier: "Project No." },
  { name: "EU Tender (ted.europa.eu)", category: "International", identifier: "Contract Notice No." },
  { name: "AfDB (African Dev. Bank)", category: "International", identifier: "Project / IFB No." },
  { name: "EBRD Procurement", category: "International", identifier: "Tender No." },
  { name: "Tenderwizard", category: "Private / Other", identifier: "Tender No." },
  { name: "Bidassist", category: "Private / Other", identifier: "Tender No." },
  { name: "Tendersniper", category: "Private / Other", identifier: "Tender No." },
  { name: "eProcurement Technologies (ETL)", category: "Private / Other", identifier: "Tender / Bid No." },
  { name: "C1 India", category: "Private / Other", identifier: "RFQ / RFP No." },
  { name: "Private / Direct (Email / Newspaper)", category: "Private / Other", identifier: "Ref. No. (if any)" },
  { name: "Direct from Client", category: "Private / Other", identifier: "Ref. No. (if any)" },
  { name: "Newspaper Advertisement", category: "Private / Other", identifier: "Ad Ref. / Date" },
  { name: "Industry Referral", category: "Private / Other", identifier: "Ref. No. (if any)" },
  { name: "Other", category: "Private / Other", identifier: "Ref. / ID No." },
];
export const PORTAL_CATEGORIES = ["All", "Central Govt", "State Govt", "International", "Private / Other"];

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal", "Andaman & Nicobar Islands", "Chandigarh", "Dadra & Nagar Haveli",
  "Daman & Diu", "Delhi", "Jammu & Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

export const FIELD_LABELS = {
  person_responsible_id: "Person Responsible",
  reviewer_id: "Reviewer",
  approval_authority_id: "Approval Authority",
};

export const LEAD_STOPWORDS = new Set([
  "request", "requests", "for", "proposal", "proposals", "rfp", "rfps",
  "eoi", "eois", "expression", "expressions", "interest", "tender",
  "tenders", "notice", "notices", "inviting", "invitation", "nit",
  "bid", "bids", "bidding", "document", "documents", "doc",
  "ref", "reference", "no", "nos", "number",
  "of", "and", "the", "to", "a", "an", "on", "in", "at", "by", "with",
  "from", "or", "as", "is", "are", "shall", "be",
]);

export function normLeadText(t) {
  return (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function leadTokens(t) {
  return normLeadText(t).split(" ").filter((w) => w.length > 1 && !LEAD_STOPWORDS.has(w));
}