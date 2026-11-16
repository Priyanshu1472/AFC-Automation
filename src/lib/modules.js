// Module ON/OFF switch ("Coming Soon") — see docs/GO-LIVE-PLAN.md §3.
//
// VITE_APP_ENV decides whether the switch applies at all:
//   - "production": a module whose app_modules row is OFF disappears from
//     the navbar/Home and its URLs show the Coming Soon page.
//   - anything else (staging, local dev, unset): every module is always ON,
//     whatever the table says, so staff can test everything.
// The backend mirrors this with the APP_ENV secret (_shared/modules.ts).

export const APP_ENV = (import.meta.env.VITE_APP_ENV || "staging").toLowerCase();
export const IS_PRODUCTION = APP_ENV === "production";

// Display order on the Module Settings page.
export const MODULES = [
  { key: "empanelment", label: "BP Empanelment", description: "Business Partner empanelment, including the public BP form, status and correction pages." },
  { key: "leads", label: "Leads Approval", description: "Lead creation and the approval workflow, plus its dashboard and reports." },
  { key: "proposals", label: "Proposals", description: "Proposal preparation and the Bid Payment Requisition Note." },
  { key: "monitoring", label: "Monitoring", description: "Awarded-project monitoring and client invoices." },
  { key: "financials", label: "Financials", description: "Invoices, payment notes and BP payments." },
  { key: "knowledge", label: "Knowledge Repository", description: "Past-project search, shortlists and company documents." },
];

export const MODULE_LABELS = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));

// Route → module. Anything not matched (login, password pages, /home,
// /profile, users/admin pages, /audit-logs, Module Settings) is always on.
export function moduleForPath(pathname) {
  const p = (pathname || "").toLowerCase();
  const under = (prefix) => p === prefix || p.startsWith(`${prefix}/`);
  if (under("/empanelment") || under("/dashboard/empanelment") || under("/reports/empanelment") || under("/ba-form")) return "empanelment";
  if (under("/leads") || under("/dashboard/leads") || under("/reports/leads")) return "leads";
  if (under("/proposals")) return "proposals";
  if (under("/monitoring")) return "monitoring";
  if (under("/financials")) return "financials";
  if (under("/knowledge")) return "knowledge";
  return null;
}
