#!/usr/bin/env node
// Seeds a full demo dataset for presenting the portal: one staff account per
// role (two parallel teams, BPDD and CBBO, for the team-scoped roles) plus
// nine sample empanelment applications covering every pipeline status.
//
// Every account uses Gmail "+tag" addressing off a single real inbox (e.g.
// you+md@gmail.com), so real emails (OTP codes, notifications) land in that
// one inbox during a live demo — no throwaway/fake domains involved.
//
// This is NOT the same script as seed-test-users.mjs (that one is for CI/E2E
// and uses a fake domain with no application data). This one is for a
// human-facing demo walkthrough.
//
// Usage:
//   node scripts/seed-demo-data.mjs --yes-i-am-sure-this-is-not-prod [--ci] [--email-accounts]
//
// Required env vars — put these in .env.local (already gitignored) so the
// service-role key never appears in your shell history or this terminal:
//   SUPABASE_URL (falls back to VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  (Project Settings -> API -> service_role, in
//                               the Supabase dashboard — never the anon key)
// Optional:
//   DEMO_EMAIL_BASE  (default: priyanshu.arora.afc@gmail.com)
//   DEMO_PASSWORD    (default: TestPass123!)
//   RESEND_API_KEY   (only needed with --email-accounts — sends each demo
//                     account a "your account is ready" email with its
//                     login info; account creation itself never emails)

import { createClient } from "@supabase/supabase-js";
import readline from "node:readline/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Unconditional — ignores every CLI flag, same convention as
// seed-test-users.mjs. Fill in once a real prod-vs-staging split exists.
const PROD_PROJECT_REF_DENYLIST = ["REPLACE_WITH_PROD_PROJECT_REF"];

// ── Load .env.local ourselves (no dotenv dependency in this repo) so the
// service-role key can live only in a gitignored file, never typed into
// this terminal. ──────────────────────────────────────────────────────
function loadDotEnvLocal() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnvLocal();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_BASE = process.env.DEMO_EMAIL_BASE || "priyanshu.arora.afc@gmail.com";
const PASSWORD = process.env.DEMO_PASSWORD || "TestPass123!";

const ROLE_LABELS = {
  md: "Managing Director", cfo: "Chief Financial Officer", cs: "Company Secretary",
  dgm: "Deputy General Manager", agm: "Assistant General Manager", srm: "Senior Regional Manager",
  project_officer: "Project Officer", associate_consultant: "Associate Consultant", admin: "Administrator",
};

// Supplementary "your demo account is ready" email — sent only when
// --email-accounts is passed and RESEND_API_KEY is set. This is separate
// from the real create-staff-user onboarding email (which this script
// deliberately bypasses so every demo account can share one password) —
// it exists purely so each account's inbox has a confirmation it exists.
async function sendAccountReadyEmail(to, fullName, role, team) {
  const roleLabel = ROLE_LABELS[role] || role;
  const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
    <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
        <tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;max-width:600px;width:100%;">
            <tr><td style="padding:24px 32px;background:#1a5fd4;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">AFC India Limited</p>
              <p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,0.75);">Demo Portal</p>
            </td></tr>
            <tr><td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear ${fullName},</p>
              <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
                Your demo <strong>${roleLabel}</strong>${team ? ` (${team} team)` : ""} account is ready.
              </p>
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.08em;">Email</p>
                <p style="margin:0 0 14px;font-size:14px;color:#111827;font-family:monospace;">${to}</p>
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.08em;">Password</p>
                <p style="margin:0;font-size:18px;font-weight:700;color:#111827;font-family:monospace;letter-spacing:0.05em;">${PASSWORD}</p>
              </div>
              <p style="margin:0;font-size:13px;color:#374151;">This is a demo account seeded for a portal walkthrough, not a real staff onboarding email.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "AFC India Limited <noreply@pmis.afcindia.org.in>",
      to: [to],
      subject: "Your AFC India Limited demo account is ready",
      html,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
}

const [EMAIL_LOCAL, EMAIL_DOMAIN] = EMAIL_BASE.split("@");
function aliasEmail(tag) {
  return `${EMAIL_LOCAL}+${tag}@${EMAIL_DOMAIN}`;
}

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
}

// ── Staff accounts ──────────────────────────────────────────────────
const OFFICE_BY_TEAM = { BPDD: "delhi", CBBO: "mumbai" };
const TEAMS = ["BPDD", "CBBO"];

const COMPANY_WIDE = [
  { tag: "md", full_name: "Priyanshu (Demo MD)", role: "md", team: null, office: null },
  { tag: "cfo", full_name: "Priyanshu (Demo CFO)", role: "cfo", team: null, office: "delhi" },
  { tag: "cs", full_name: "Priyanshu (Demo CS)", role: "cs", team: null, office: "delhi" },
  { tag: "admin", full_name: "Priyanshu (Demo Admin)", role: "admin", team: null, office: "delhi" },
];

const TEAM_ROLE_DEFS = [
  { role: "dgm", short: "DGM" },
  { role: "agm", short: "AGM" },
  { role: "srm", short: "SRM" },
  { role: "project_officer", short: "PO" },
  { role: "associate_consultant", short: "AC" },
];

const STAFF_USERS = [
  ...COMPANY_WIDE,
  ...TEAMS.flatMap((team) =>
    TEAM_ROLE_DEFS.map((def) => ({
      tag: `${def.short.toLowerCase()}-${team.toLowerCase()}`,
      full_name: `Priyanshu (Demo ${def.short} - ${team})`,
      role: def.role,
      team,
      office: OFFICE_BY_TEAM[team],
    }))
  ),
].map((u) => ({ ...u, key: `${u.role}:${u.team || "none"}` }));

// ── Sample BA org data, reused across applications ─────────────────
function baseBaData(overrides) {
  return {
    entity_type: "Private Ltd.",
    year_established: 2012,
    reg_address: "12 MG Road, New Delhi, 110001",
    designation: "Managing Partner",
    companies_act_status: "Compliant",
    company_status: "Active",
    date_of_incorporation: "2012-06-15",
    core_expertise: "Agri-business advisory and rural livelihood project management",
    sectors_served: ["Agriculture", "Livelihood"],
    bank_name: "HDFC Bank",
    bank_branch: "Connaught Place, New Delhi",
    account_number: "50100123456789",
    ifsc_code: "HDFC0001234",
    pan: "AABCU9603R",
    net_worth: { fy22: "45", fy23: "62", fy24: "80" },
    turnover: { fy22: "120", fy23: "150", fy24: "190" },
    pat: { fy22: "8", fy23: "11", fy24: "15" },
    cash_flow: { fy22: "Yes", fy23: "Yes", fy24: "Yes" },
    team_size: 18,
    years_experience: 11,
    assignments: [
      { title: "Rural credit outreach program", client: "State Cooperative Bank", duration: "18 months", value: "1.2 Cr", role: "Lead Consultant" },
    ],
    declaration_accepted: true,
    documents: [],
    ...overrides,
  };
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}
function hoursAgo(n) {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

// ── Sample applications, one per pipeline status ────────────────────
// The "sent" and "md_review" apps are deliberately left NOT fully
// resolved — those are the ones meant to be walked through live in the
// real UI (BA form submission with the noted code; MD accept/reject with
// a real emailed OTP).
const APPLICATIONS = [
  {
    id: "sent",
    team: "BPDD",
    status: "sent",
    baTag: "ba-sent",
    orgName: "Amrit Rural Ventures Pvt Ltd",
    live: true,
    liveNote: "LIVE DEMO: use the Application Code below on the public /ba-form page to submit as this BA.",
    activity: [{ actor: "ac", action: "sent", comment: "Invitation sent.", at: hoursAgo(2) }],
  },
  {
    id: "po_review",
    team: "CBBO",
    status: "po_review",
    baTag: "ba-poreview",
    orgName: "Greenfield Agri Consultants Pvt Ltd",
    baData: baseBaData({ contact_person: "Rakesh Menon", phone: "9820011223", email: null, gst: "27AABCU9603R1ZV" }),
    formSubmittedDaysAgo: 5,
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(9) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Greenfield Agri Consultants Pvt Ltd. Documents uploaded: 0.", at: daysAgo(5) },
    ],
  },
  {
    id: "cfo_cs_review",
    team: "BPDD",
    status: "cfo_cs_review",
    baTag: "ba-cfocs",
    orgName: "Sunrise Rural Advisory LLP",
    baData: baseBaData({ entity_type: "LLP", contact_person: "Sunita Rao", phone: "9871122334", email: null }),
    formSubmittedDaysAgo: 6,
    po_comment: "Documents verified, financials look consistent with turnover claims. Recommended for CFO/CS review.",
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(10) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Sunrise Rural Advisory LLP. Documents uploaded: 0.", at: daysAgo(6) },
      { actor: "project_officer", action: "po_forwarded", comment: "Documents verified, financials look consistent with turnover claims. Recommended for CFO/CS review.", at: daysAgo(4) },
    ],
  },
  {
    id: "po_final_review",
    team: "CBBO",
    status: "po_final_review",
    baTag: "ba-pofinal",
    orgName: "Kisan Bridge Financial Services",
    baData: baseBaData({ contact_person: "Anil Deshmukh", phone: "9812233445", email: null, entity_type: "Partnership" }),
    formSubmittedDaysAgo: 8,
    po_comment: "Strong track record in the region, forwarding for CFO/CS review.",
    cfo_comment: "Financials reviewed — net worth and turnover trend acceptable.",
    cfo_reviewed: true,
    cs_comment: "No compliance concerns from a company-secretarial standpoint.",
    cs_reviewed: true,
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(12) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Kisan Bridge Financial Services. Documents uploaded: 0.", at: daysAgo(8) },
      { actor: "project_officer", action: "po_forwarded", comment: "Strong track record in the region, forwarding for CFO/CS review.", at: daysAgo(6) },
      { actor: "cfo", action: "cfo_reviewed", comment: "Financials reviewed — net worth and turnover trend acceptable.", at: daysAgo(4) },
      { actor: "cs", action: "cs_reviewed", comment: "No compliance concerns from a company-secretarial standpoint.", at: daysAgo(3) },
    ],
  },
  {
    id: "dgm_review",
    team: "BPDD",
    status: "dgm_review",
    baTag: "ba-dgmreview",
    orgName: "Pragati Business Associates",
    baData: baseBaData({ contact_person: "Meera Iyer", phone: "9823344556", email: null }),
    formSubmittedDaysAgo: 9,
    po_comment: "Recommended after document verification.",
    cfo_comment: "Cleared.",
    cfo_reviewed: true,
    cs_comment: "Cleared.",
    cs_reviewed: true,
    po_final_comment: "Final look complete, forwarding to DGM.",
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(13) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Pragati Business Associates. Documents uploaded: 0.", at: daysAgo(9) },
      { actor: "project_officer", action: "po_forwarded", comment: "Recommended after document verification.", at: daysAgo(7) },
      { actor: "cfo", action: "cfo_reviewed", comment: "Cleared.", at: daysAgo(5) },
      { actor: "cs", action: "cs_reviewed", comment: "Cleared.", at: daysAgo(5) },
      { actor: "project_officer", action: "po_final_forwarded", comment: "Final look complete, forwarding to DGM.", at: daysAgo(2) },
    ],
  },
  {
    id: "md_review",
    team: "CBBO",
    status: "md_review",
    baTag: "ba-mdreview",
    orgName: "Vikas Micro Enterprises Network",
    live: true,
    liveNote: "LIVE DEMO: log in as the MD account and Accept or Reject this application to trigger a real OTP email to your own inbox.",
    baData: baseBaData({ contact_person: "Devendra Patil", phone: "9834455667", email: null, entity_type: "Proprietorship" }),
    formSubmittedDaysAgo: 7,
    po_comment: "All documents in order.",
    cfo_comment: "Financials acceptable.",
    cfo_reviewed: true,
    cs_comment: "No concerns.",
    cs_reviewed: true,
    po_final_comment: "Forwarding to DGM.",
    dgm_comment: "Recommended for empanelment. Good regional presence and clean track record.",
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(11) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Vikas Micro Enterprises Network. Documents uploaded: 0.", at: daysAgo(7) },
      { actor: "project_officer", action: "po_forwarded", comment: "All documents in order.", at: daysAgo(6) },
      { actor: "cfo", action: "cfo_reviewed", comment: "Financials acceptable.", at: daysAgo(4) },
      { actor: "cs", action: "cs_reviewed", comment: "No concerns.", at: daysAgo(4) },
      { actor: "project_officer", action: "po_final_forwarded", comment: "Forwarding to DGM.", at: daysAgo(2) },
      { actor: "dgm", action: "dgm_recommended", comment: "Recommended for empanelment. Good regional presence and clean track record.", at: hoursAgo(3) },
    ],
  },
  {
    id: "on_hold",
    team: "CBBO",
    status: "on_hold",
    holdOriginStatus: "po_review",
    baTag: "ba-onhold",
    orgName: "Sahayog Rural Solutions",
    baData: baseBaData({ contact_person: "Farida Sheikh", phone: "9845566778", email: null, pan: "AABCU960R" }),
    formSubmittedDaysAgo: 4,
    complianceFlags: [
      { field_key: "pan", field_label: "PAN Number", comment: "PAN entered does not match the standard 10-character format — please re-verify and resubmit." },
      { field_key: "gst", field_label: "GST Registration Number", comment: "GST number missing though turnover suggests GST registration should apply." },
    ],
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(6) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Sahayog Rural Solutions. Documents uploaded: 0.", at: daysAgo(4) },
      { actor: "project_officer", action: "hold_raised", comment: "2 item(s) flagged: PAN Number, GST Registration Number", at: daysAgo(2) },
    ],
  },
  {
    id: "accepted",
    team: "BPDD",
    status: "accepted",
    baTag: "ba-accepted",
    orgName: "Unnati Agribusiness Partners",
    baData: baseBaData({ contact_person: "Karan Bhatia", phone: "9856677889", email: null }),
    formSubmittedDaysAgo: 15,
    po_comment: "Excellent documentation.",
    cfo_comment: "Approved.",
    cfo_reviewed: true,
    cs_comment: "Approved.",
    cs_reviewed: true,
    po_final_comment: "Forwarding to DGM.",
    dgm_comment: "Strongly recommended.",
    md_remarks: "Approved. Welcome to the AFC India Limited BA network.",
    decidedDaysAgo: 1,
    provisionBaAccount: true,
    empanelmentRef: "AFC/BA/2026/DEMO-001",
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(20) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Unnati Agribusiness Partners. Documents uploaded: 0.", at: daysAgo(15) },
      { actor: "project_officer", action: "po_forwarded", comment: "Excellent documentation.", at: daysAgo(12) },
      { actor: "cfo", action: "cfo_reviewed", comment: "Approved.", at: daysAgo(9) },
      { actor: "cs", action: "cs_reviewed", comment: "Approved.", at: daysAgo(9) },
      { actor: "project_officer", action: "po_final_forwarded", comment: "Forwarding to DGM.", at: daysAgo(5) },
      { actor: "dgm", action: "dgm_recommended", comment: "Strongly recommended.", at: daysAgo(3) },
      { actor: "md", action: "md_accepted", comment: "Approved. Welcome to the AFC India Limited BA network. (Empanelment Letter Ref: AFC/BA/2026/DEMO-001, valid until 3 years from acceptance)", at: daysAgo(1) },
    ],
  },
  {
    id: "rejected",
    team: "CBBO",
    status: "rejected",
    baTag: "ba-rejected",
    orgName: "Nirman Infra Advisors",
    baData: baseBaData({ contact_person: "Suresh Nair", phone: "9867788990", email: null, entity_type: "Partnership" }),
    formSubmittedDaysAgo: 14,
    po_comment: "Financials look thin relative to scale of proposed engagements.",
    cfo_comment: "Net worth insufficient for the sectors applied for.",
    cfo_reviewed: true,
    cs_comment: "No compliance objection, but defer to CFO's financial assessment.",
    cs_reviewed: true,
    po_final_comment: "Forwarding with reservations noted by CFO.",
    dgm_comment: "Concur with CFO's assessment — do not recommend at this time.",
    md_remarks: "Rejected. Net worth and turnover do not currently meet AFC's empanelment threshold for the sectors applied for. Welcome to reapply after the next audited financial year.",
    decidedDaysAgo: 2,
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(19) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Nirman Infra Advisors. Documents uploaded: 0.", at: daysAgo(14) },
      { actor: "project_officer", action: "po_forwarded", comment: "Financials look thin relative to scale of proposed engagements.", at: daysAgo(11) },
      { actor: "cfo", action: "cfo_reviewed", comment: "Net worth insufficient for the sectors applied for.", at: daysAgo(8) },
      { actor: "cs", action: "cs_reviewed", comment: "No compliance objection, but defer to CFO's financial assessment.", at: daysAgo(8) },
      { actor: "project_officer", action: "po_final_forwarded", comment: "Forwarding with reservations noted by CFO.", at: daysAgo(5) },
      { actor: "dgm", action: "dgm_recommended", comment: "Concur with CFO's assessment — do not recommend at this time.", at: daysAgo(3) },
      { actor: "md", action: "md_rejected", comment: "Rejected. Net worth and turnover do not currently meet AFC's empanelment threshold for the sectors applied for.", at: daysAgo(2) },
    ],
  },
];

// Extra history-only sample applications, purely for dashboard/reports
// variety — spread across the last ~100 days (the Reports page's Monthly
// Trend and turnaround-time views group by created_at, so a realistic
// spread matters more here than the exact org details). None of these are
// "live" — all already resolved or mid-pipeline, nothing to walk through.
function resolvedFiller({ id, team, baTag, orgName, contactPerson, accepted, sentDaysAgo, decidedDaysAgo }) {
  const filledDaysAgo = sentDaysAgo - 4;
  const poDaysAgo = filledDaysAgo - 3;
  const cfoCsDaysAgo = poDaysAgo - 3;
  const poFinalDaysAgo = cfoCsDaysAgo - 3;
  const dgmDaysAgo = poFinalDaysAgo - 2;
  return {
    id,
    team,
    status: accepted ? "accepted" : "rejected",
    baTag,
    orgName,
    baData: baseBaData({ contact_person: contactPerson, phone: "98" + String(10000000 + Math.floor(Math.random() * 89999999)) }),
    formSubmittedDaysAgo: filledDaysAgo,
    po_comment: accepted ? "Documentation in order, recommended." : "Some concerns on financial scale, forwarding for review.",
    cfo_comment: accepted ? "Financials acceptable." : "Net worth below the threshold for the sectors applied for.",
    cfo_reviewed: true,
    cs_comment: accepted ? "No concerns." : "Deferring to CFO's financial assessment.",
    cs_reviewed: true,
    po_final_comment: "Forwarding to DGM.",
    dgm_comment: accepted ? "Recommended for empanelment." : "Concur with CFO — do not recommend at this time.",
    md_remarks: accepted
      ? "Approved. Welcome to the AFC India Limited BA network."
      : "Rejected. Does not currently meet AFC's empanelment threshold. Welcome to reapply after the next audited financial year.",
    decidedDaysAgo,
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(sentDaysAgo) },
      { actor: "ba", action: "ba_filled", comment: `BA form submitted by ${orgName}. Documents uploaded: 0.`, at: daysAgo(filledDaysAgo) },
      { actor: "project_officer", action: "po_forwarded", comment: accepted ? "Documentation in order, recommended." : "Some concerns on financial scale, forwarding for review.", at: daysAgo(poDaysAgo) },
      { actor: "cfo", action: "cfo_reviewed", comment: accepted ? "Financials acceptable." : "Net worth below the threshold for the sectors applied for.", at: daysAgo(cfoCsDaysAgo) },
      { actor: "cs", action: "cs_reviewed", comment: accepted ? "No concerns." : "Deferring to CFO's financial assessment.", at: daysAgo(cfoCsDaysAgo) },
      { actor: "project_officer", action: "po_final_forwarded", comment: "Forwarding to DGM.", at: daysAgo(poFinalDaysAgo) },
      { actor: "dgm", action: "dgm_recommended", comment: accepted ? "Recommended for empanelment." : "Concur with CFO — do not recommend at this time.", at: daysAgo(dgmDaysAgo) },
      { actor: "md", action: accepted ? "md_accepted" : "md_rejected", comment: accepted ? "Approved." : "Rejected — see remarks.", at: daysAgo(decidedDaysAgo) },
    ],
  };
}

APPLICATIONS.push(
  resolvedFiller({ id: "filler_accepted_1", team: "BPDD", baTag: "ba-d1", orgName: "Bharat Krishi Solutions Pvt Ltd", contactPerson: "Vinod Kumar", accepted: true, sentDaysAgo: 100, decidedDaysAgo: 88 }),
  resolvedFiller({ id: "filler_accepted_2", team: "CBBO", baTag: "ba-d2", orgName: "Rural Edge Consultants LLP", contactPerson: "Neha Kapoor", accepted: true, sentDaysAgo: 70, decidedDaysAgo: 60 }),
  resolvedFiller({ id: "filler_accepted_3", team: "BPDD", baTag: "ba-d3", orgName: "Sanchar Development Group", contactPerson: "Ramesh Pillai", accepted: true, sentDaysAgo: 45, decidedDaysAgo: 36 }),
  resolvedFiller({ id: "filler_accepted_4", team: "CBBO", baTag: "ba-d4", orgName: "Mitra Agri Services LLP", contactPerson: "Pooja Verma", accepted: true, sentDaysAgo: 20, decidedDaysAgo: 12 }),
  resolvedFiller({ id: "filler_accepted_5", team: "BPDD", baTag: "ba-d5", orgName: "Bandhan Livelihood Partners", contactPerson: "Arvind Joshi", accepted: true, sentDaysAgo: 6, decidedDaysAgo: 2 }),
  resolvedFiller({ id: "filler_rejected_1", team: "CBBO", baTag: "ba-d6", orgName: "Disha Infra Consultants", contactPerson: "Sunil Rathi", accepted: false, sentDaysAgo: 80, decidedDaysAgo: 68 }),
  resolvedFiller({ id: "filler_rejected_2", team: "BPDD", baTag: "ba-d7", orgName: "Chetna Rural Advisory Pvt Ltd", contactPerson: "Manisha Reddy", accepted: false, sentDaysAgo: 35, decidedDaysAgo: 26 }),
  resolvedFiller({ id: "filler_rejected_3", team: "CBBO", baTag: "ba-d8", orgName: "Vistaar Business Solutions", contactPerson: "Ajay Malhotra", accepted: false, sentDaysAgo: 11, decidedDaysAgo: 4 }),
  {
    id: "filler_onhold_1",
    team: "BPDD",
    status: "on_hold",
    holdOriginStatus: "po_review",
    baTag: "ba-d9",
    orgName: "Aadhar Agri Ventures",
    baData: baseBaData({ contact_person: "Kavita Desai", phone: "9811122233" }),
    formSubmittedDaysAgo: 22,
    complianceFlags: [{ field_key: "gst", field_label: "GST Registration Number", comment: "GST number format looks incorrect — please re-verify and resubmit." }],
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(26) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Aadhar Agri Ventures. Documents uploaded: 0.", at: daysAgo(22) },
      { actor: "project_officer", action: "hold_raised", comment: "1 item(s) flagged: GST Registration Number", at: daysAgo(18) },
    ],
  },
  {
    id: "filler_onhold_2",
    team: "CBBO",
    status: "on_hold",
    holdOriginStatus: "dgm_review",
    baTag: "ba-d10",
    orgName: "Nav Bharat Consultants",
    baData: baseBaData({ contact_person: "Rohit Sharma", phone: "9822233344" }),
    formSubmittedDaysAgo: 18,
    po_comment: "Recommended after verification.",
    cfo_comment: "Cleared.",
    cfo_reviewed: true,
    cs_comment: "Cleared.",
    cs_reviewed: true,
    po_final_comment: "Forwarding to DGM.",
    complianceFlags: [{ field_key: "director_kyc", field_label: "Director / Partner Details and KYC", comment: "KYC details incomplete for one of the listed directors." }],
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(22) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Nav Bharat Consultants. Documents uploaded: 0.", at: daysAgo(18) },
      { actor: "project_officer", action: "po_forwarded", comment: "Recommended after verification.", at: daysAgo(15) },
      { actor: "cfo", action: "cfo_reviewed", comment: "Cleared.", at: daysAgo(12) },
      { actor: "cs", action: "cs_reviewed", comment: "Cleared.", at: daysAgo(12) },
      { actor: "project_officer", action: "po_final_forwarded", comment: "Forwarding to DGM.", at: daysAgo(9) },
      { actor: "dgm", action: "hold_raised", comment: "1 item(s) flagged: Director / Partner Details and KYC", at: daysAgo(7) },
    ],
  },
  {
    id: "filler_sent_1",
    team: "BPDD",
    status: "sent",
    baTag: "ba-d11",
    orgName: "Sparsh Rural Network",
    activity: [{ actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(3) }],
  },
  {
    id: "filler_sent_2",
    team: "CBBO",
    status: "sent",
    baTag: "ba-d12",
    orgName: "Utkarsh Agri Associates",
    activity: [{ actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(1) }],
  },
  {
    id: "filler_poreview_1",
    team: "BPDD",
    status: "po_review",
    baTag: "ba-d13",
    orgName: "Jagriti Business Solutions",
    baData: baseBaData({ contact_person: "Nikhil Bansal", phone: "9833344455" }),
    formSubmittedDaysAgo: 4,
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(8) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Jagriti Business Solutions. Documents uploaded: 0.", at: daysAgo(4) },
    ],
  },
  {
    id: "filler_poreview_2",
    team: "CBBO",
    status: "po_review",
    baTag: "ba-d14",
    orgName: "Him Alpine Consultants",
    baData: baseBaData({ contact_person: "Tashi Bhutia", phone: "9844455566" }),
    formSubmittedDaysAgo: 6,
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(12) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Him Alpine Consultants. Documents uploaded: 0.", at: daysAgo(6) },
    ],
  },
  {
    id: "filler_cfocs_1",
    team: "BPDD",
    status: "cfo_cs_review",
    baTag: "ba-d15",
    orgName: "Sahyog Development Partners",
    baData: baseBaData({ contact_person: "Preeti Chawla", phone: "9855566677" }),
    formSubmittedDaysAgo: 14,
    po_comment: "Documentation verified, forwarding for CFO/CS review.",
    activity: [
      { actor: "ac", action: "sent", comment: "Invitation sent.", at: daysAgo(18) },
      { actor: "ba", action: "ba_filled", comment: "BA form submitted by Sahyog Development Partners. Documents uploaded: 0.", at: daysAgo(14) },
      { actor: "project_officer", action: "po_forwarded", comment: "Documentation verified, forwarding for CFO/CS review.", at: daysAgo(11) },
    ],
  }
);

function generateAppCode() {
  return String(10000 + Math.floor(Math.random() * 90000));
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes-i-am-sure-this-is-not-prod");
  const isCi = args.includes("--ci");
  const emailAccounts = args.includes("--email-accounts");

  if (emailAccounts && !RESEND_API_KEY) {
    console.error("ERROR: --email-accounts was passed but RESEND_API_KEY is not set. Add it to .env.local and re-run.");
    process.exit(1);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("ERROR: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set.");
    console.error("Add SUPABASE_SERVICE_ROLE_KEY to .env.local (find it in the Supabase dashboard under Project Settings -> API -> service_role) and re-run.");
    process.exit(1);
  }

  const targetRef = projectRefFromUrl(SUPABASE_URL);
  if (targetRef && PROD_PROJECT_REF_DENYLIST.includes(targetRef)) {
    console.error(`Refusing to run: ${SUPABASE_URL} resolves to the production project ref.`);
    process.exit(1);
  }
  if (!confirmed) {
    console.error("Refusing to run without --yes-i-am-sure-this-is-not-prod.");
    process.exit(1);
  }

  console.log(`Target Supabase project: ${SUPABASE_URL} (ref: ${targetRef})`);
  console.log(`Email base for all demo accounts: ${EMAIL_BASE} (+tag aliasing)`);

  if (!isCi) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Type 'y' to seed demo data into this project: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results = { usersCreated: [], usersReused: [], usersFailed: [], appsCreated: [], appsSkipped: [], appsFailed: [] };
  const userIdByKey = new Map();

  // ── Staff accounts ──────────────────────────────────────────────
  console.log("\n=== Creating staff accounts ===");
  for (const u of STAFF_USERS) {
    const email = aliasEmail(u.tag);
    try {
      const { data: existingProfile } = await admin.from("afc_users").select("id").eq("email", email).maybeSingle();
      if (existingProfile) {
        userIdByKey.set(u.key, existingProfile.id);
        results.usersReused.push({ email, role: u.role, team: u.team });
        console.log(`  = ${email} (${u.role}) already exists, reusing`);
        continue;
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (createErr || !created?.user) {
        results.usersFailed.push({ email, role: u.role, reason: createErr?.message || "Unknown error creating auth user." });
        console.error(`  x ${email}: ${createErr?.message || "Unknown error creating auth user."}`);
        continue;
      }

      const { error: insertErr } = await admin.from("afc_users").insert({
        id: created.user.id,
        full_name: u.full_name,
        email,
        role: u.role,
        team: u.team,
        office: u.office,
        is_active: true,
        must_change_password: false,
      });
      if (insertErr) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
        results.usersFailed.push({ email, role: u.role, reason: `Profile insert failed: ${insertErr.message}` });
        console.error(`  x ${email} (profile insert): ${insertErr.message}`);
        continue;
      }

      try {
        await admin.from("notifications").insert({
          user_id: created.user.id,
          title: "Welcome to AFC India Limited",
          sub_text: `Your demo ${u.role} account is ready.`,
          type: "account_created",
          link: "/home",
        });
      } catch {
        // Best-effort — a welcome notification failing must never mark the
        // account itself as failed (the auth user + profile are already saved).
      }

      userIdByKey.set(u.key, created.user.id);
      results.usersCreated.push({ email, role: u.role, team: u.team });
      console.log(`  ✓ ${email} (${u.role}${u.team ? `, ${u.team}` : ""})`);
    } catch (err) {
      results.usersFailed.push({ email, role: u.role, reason: err.message || String(err) });
      console.error(`  x ${email}: ${err.message || err}`);
    }
  }

  // ── Supplementary account-ready emails (opt-in) ──────────────────
  if (emailAccounts) {
    console.log("\n=== Emailing account details (--email-accounts) ===");
    for (const u of STAFF_USERS) {
      const email = aliasEmail(u.tag);
      try {
        await sendAccountReadyEmail(email, u.full_name, u.role, u.team);
        console.log(`  ✓ emailed ${email}`);
      } catch (err) {
        console.error(`  x ${email}: ${err.message || err}`);
      }
    }
  }

  // ── Sample applications ─────────────────────────────────────────
  console.log("\n=== Creating sample empanelment applications ===");
  for (const app of APPLICATIONS) {
    const baEmail = aliasEmail(app.baTag);
    try {
      const { data: existingApp } = await admin.from("empanelment_applications").select("id, application_code").eq("ba_email", baEmail).maybeSingle();
      if (existingApp) {
        results.appsSkipped.push({ orgName: app.orgName, baEmail, reason: "already seeded" });
        console.log(`  = ${app.orgName} (${baEmail}) already exists, skipping`);
        continue;
      }

      const acId = userIdByKey.get(`associate_consultant:${app.team}`);
      const poId = userIdByKey.get(`project_officer:${app.team}`);
      const dgmId = userIdByKey.get(`dgm:${app.team}`);
      if (!acId || !poId) {
        throw new Error(`Missing required team users for team ${app.team} (AC/PO not created) — cannot seed this application.`);
      }

      const applicationCode = generateAppCode();
      const firstActivityAt = app.activity[0]?.at || daysAgo(1);
      const insertRow = {
        application_code: applicationCode,
        status: app.status,
        ba_email: baEmail,
        team: app.team,
        office: OFFICE_BY_TEAM[app.team],
        sent_by: acId,
        project_officer_id: poId,
        dgm_id: dgmId || null,
        sent_at: firstActivityAt,
        // The Reports page's Monthly Trend and turnaround-time calculations
        // group by created_at, which otherwise defaults to now() for every
        // row inserted here — that would bucket every sample application
        // into "this month" regardless of its actual invite date.
        created_at: firstActivityAt,
      };
      if (app.formSubmittedDaysAgo != null) insertRow.form_submitted_at = daysAgo(app.formSubmittedDaysAgo);
      if (app.po_comment) insertRow.po_comment = app.po_comment;
      if (app.po_final_comment) insertRow.po_final_comment = app.po_final_comment;
      if (app.cfo_comment) insertRow.cfo_comment = app.cfo_comment;
      if (app.cfo_reviewed) insertRow.cfo_reviewed = true;
      if (app.cs_comment) insertRow.cs_comment = app.cs_comment;
      if (app.cs_reviewed) insertRow.cs_reviewed = true;
      if (app.dgm_comment) insertRow.dgm_comment = app.dgm_comment;
      if (app.md_remarks) insertRow.md_remarks = app.md_remarks;
      if (app.decidedDaysAgo != null) insertRow.decided_at = daysAgo(app.decidedDaysAgo);
      if (app.holdOriginStatus) insertRow.hold_origin_status = app.holdOriginStatus;
      if (app.empanelmentRef) {
        insertRow.empanelment_ref = app.empanelmentRef;
        insertRow.empanelment_expires_at = new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
      }

      const { data: inserted, error: appErr } = await admin.from("empanelment_applications").insert(insertRow).select("id").single();
      if (appErr) throw new Error(`Application insert failed: ${appErr.message}`);
      const applicationId = inserted.id;

      // Everything past this point is rolled back (application row deleted,
      // cascading to any child rows already inserted) on failure, so a
      // re-run always starts this application fresh instead of leaving a
      // half-seeded row that "already exists" checks would skip forever.
      try {
        if (app.baData) {
          const { error: regErr } = await admin.from("ba_registrations").insert({
            application_id: applicationId,
            submitted_at: daysAgo(app.formSubmittedDaysAgo ?? 1),
            ...app.baData,
            org_name: app.orgName,
            email: baEmail,
          });
          if (regErr) throw new Error(`ba_registrations insert failed: ${regErr.message}`);
        }

        if (app.complianceFlags?.length) {
          const holdBatchId = crypto.randomUUID();
          const { error: flagErr } = await admin.from("compliance_flags").insert(
            app.complianceFlags.map((f) => ({
              application_id: applicationId,
              hold_batch_id: holdBatchId,
              field_key: f.field_key,
              field_label: f.field_label,
              raised_by: poId,
              raised_by_role: "project_officer",
              comment: f.comment,
              status: "open",
            }))
          );
          if (flagErr) throw new Error(`compliance_flags insert failed: ${flagErr.message}`);
        }

        const { error: activityErr } = await admin.from("empanelment_activity_log").insert(
          app.activity.map((a) => ({
            application_id: applicationId,
            actor_id: a.actor === "ba" ? null : userIdByKey.get(`${a.actor}:${app.team}`) || userIdByKey.get(`${a.actor}:none`) || null,
            actor_role: a.actor,
            action: a.action,
            comment: a.comment,
            created_at: a.at,
          }))
        );
        if (activityErr) throw new Error(`empanelment_activity_log insert failed: ${activityErr.message}`);
      } catch (innerErr) {
        await admin.from("empanelment_applications").delete().eq("id", applicationId).catch(() => {});
        throw innerErr;
      }

      let baPortalEmail = null;
      if (app.provisionBaAccount) {
        const { data: baAuthUser, error: baAuthErr } = await admin.auth.admin.createUser({
          email: baEmail,
          password: PASSWORD,
          email_confirm: true,
        });
        if (baAuthErr || !baAuthUser?.user) {
          console.error(`  ! ${app.orgName}: BA portal account creation failed (non-fatal): ${baAuthErr?.message}`);
        } else {
          const { error: baProfileErr } = await admin.from("afc_users").insert({
            id: baAuthUser.user.id,
            full_name: app.baData?.contact_person || app.orgName,
            email: baEmail,
            role: "business_associate",
            is_active: true,
            must_change_password: false,
          });
          if (baProfileErr) {
            await admin.auth.admin.deleteUser(baAuthUser.user.id).catch(() => {});
            console.error(`  ! ${app.orgName}: BA profile insert failed (non-fatal): ${baProfileErr.message}`);
          } else {
            await admin.from("empanelment_applications").update({ ba_user_id: baAuthUser.user.id }).eq("id", applicationId);
            baPortalEmail = baEmail;
          }
        }
      }

      results.appsCreated.push({
        orgName: app.orgName,
        status: app.status,
        team: app.team,
        baEmail,
        applicationCode,
        live: !!app.live,
        liveNote: app.liveNote,
        baPortalEmail,
      });
      console.log(`  ✓ ${app.orgName} (${app.status}, ${app.team}) — code ${applicationCode}${baPortalEmail ? `, BA portal login created` : ""}`);
    } catch (err) {
      results.appsFailed.push({ orgName: app.orgName, baEmail, reason: err.message || String(err) });
      console.error(`  x ${app.orgName}: ${err.message || err}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  console.log(`Staff accounts: ${results.usersCreated.length} created, ${results.usersReused.length} reused, ${results.usersFailed.length} failed`);
  console.log(`Applications:   ${results.appsCreated.length} created, ${results.appsSkipped.length} skipped, ${results.appsFailed.length} failed`);
  if (results.usersFailed.length) {
    console.log("\nStaff account failures:");
    for (const f of results.usersFailed) console.log(`  - ${f.email} (${f.role}): ${f.reason}`);
  }
  if (results.appsFailed.length) {
    console.log("\nApplication failures:");
    for (const f of results.appsFailed) console.log(`  - ${f.orgName} (${f.baEmail}): ${f.reason}`);
  }

  // The credentials file is built from a fresh DB read, not from what this
  // particular run did — otherwise re-running the script (e.g. to retry one
  // failed item) silently drops accounts/applications that were reused or
  // skipped this time from the file, even though they still exist.
  const snapshot = await buildSnapshot(admin);
  writeCredentialsFile(snapshot);
  console.log(`\nCredentials + demo notes written to ${path.join(REPO_ROOT, "demo-credentials.md")}`);
  if (results.usersFailed.length || results.appsFailed.length) {
    console.log("\nCompleted with some failures — see above and the generated file for details.");
  } else {
    console.log("\nDone.");
  }
}

// Reads the actual current DB state for every account/application this
// script knows about, rather than trusting this run's in-memory results —
// so the credentials file is always a complete, accurate snapshot even if
// some accounts were reused, some skipped, and some newly created in the
// same run (or across several runs).
async function buildSnapshot(admin) {
  const staffEmails = STAFF_USERS.map((u) => aliasEmail(u.tag));
  const { data: staffRows } = await admin.from("afc_users").select("email, role, team, office").in("email", staffEmails);
  const staffByEmail = new Map((staffRows || []).map((u) => [u.email, u]));
  const staff = STAFF_USERS.map((u) => {
    const email = aliasEmail(u.tag);
    const row = staffByEmail.get(email);
    return { email, role: u.role, team: row?.team ?? u.team, exists: !!row };
  });

  const appBaEmails = APPLICATIONS.map((a) => aliasEmail(a.baTag));
  const { data: appRows } = await admin.from("empanelment_applications").select("ba_email, status, team, application_code, ba_user_id").in("ba_email", appBaEmails);
  const appByEmail = new Map((appRows || []).map((a) => [a.ba_email, a]));
  const applications = APPLICATIONS.map((def) => {
    const baEmail = aliasEmail(def.baTag);
    const row = appByEmail.get(baEmail);
    return {
      orgName: def.orgName,
      status: row?.status || null,
      team: def.team,
      baEmail,
      applicationCode: row?.application_code || null,
      live: !!def.live,
      liveNote: def.liveNote,
      baPortalEmail: row?.ba_user_id ? baEmail : null,
      exists: !!row,
    };
  });

  return { staff, applications };
}

function writeCredentialsFile(snapshot) {
  const lines = [];
  lines.push("# AFC Portal — Demo Credentials");
  lines.push("");
  lines.push("Generated by `scripts/seed-demo-data.mjs`. Do not commit this file (it's gitignored).");
  lines.push("");
  lines.push(`**Shared password for every account below:** \`${PASSWORD}\``);
  lines.push("");
  lines.push("Log in at your dev server's `/login` (e.g. `http://localhost:5173/login`) or your deployed site's `/login` page.");
  lines.push("");
  lines.push("## Staff accounts");
  lines.push("");
  lines.push("| Email | Role | Team |");
  lines.push("|---|---|---|");
  for (const u of snapshot.staff.filter((u) => u.exists)) {
    lines.push(`| ${u.email} | ${u.role} | ${u.team || "—"} |`);
  }
  const missingStaff = snapshot.staff.filter((u) => !u.exists);
  if (missingStaff.length) {
    lines.push("");
    lines.push("### Not created yet — re-run the script to retry these");
    for (const u of missingStaff) lines.push(`- ${u.email} (${u.role})`);
  }

  lines.push("");
  lines.push("## Sample business-associate applications");
  lines.push("");
  lines.push("| Organisation | Status | Team | BA email | Application code |");
  lines.push("|---|---|---|---|---|");
  for (const a of snapshot.applications.filter((a) => a.exists)) {
    lines.push(`| ${a.orgName} | ${a.status} | ${a.team} | ${a.baEmail} | ${a.applicationCode} |`);
  }

  const live = snapshot.applications.filter((a) => a.exists && a.live);
  if (live.length) {
    lines.push("");
    lines.push("## Live demo walkthroughs");
    lines.push("");
    for (const a of live) {
      lines.push(`### ${a.orgName} (${a.status})`);
      lines.push(a.liveNote);
      lines.push(`Application code: **${a.applicationCode}**`);
      lines.push("");
    }
  }

  const baPortal = snapshot.applications.filter((a) => a.baPortalEmail);
  if (baPortal.length) {
    lines.push("## Business Associate portal logins (accepted applications)");
    lines.push("");
    for (const a of baPortal) {
      lines.push(`- ${a.orgName}: ${a.baPortalEmail} (same shared password)`);
    }
    lines.push("");
  }

  const missingApps = snapshot.applications.filter((a) => !a.exists);
  if (missingApps.length) {
    lines.push("## Applications not created yet — re-run the script to retry these");
    lines.push("");
    for (const a of missingApps) lines.push(`- ${a.orgName} (${a.baEmail})`);
    lines.push("");
  }

  lines.push("---");
  lines.push("These are demo accounts in a live database with a shared, known password. Deactivate or delete them after the presentation.");
  lines.push("");

  writeFileSync(path.join(REPO_ROOT, "demo-credentials.md"), lines.join("\n"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
