#!/usr/bin/env node
// Focused seed for testing the recent Empanelment changes:
//   • Provisional / Empanelment letter icons on the list (open the PDF)
//   • AGM-as-advising-authority pipeline labels ("Forward to AGM", etc.)
//   • "Sent back" comments surfaced above the action buttons (DGM→PO, MD→DGM)
//   • The list's "Sent On" date filter
//
// Uses the org's REAL active staff on the REAL teams (BPDD / BIID), queried
// live. Every row's org name is prefixed "TEST FT —" so it's easy to spot
// and bulk-delete:
//   delete from empanelment_applications where ba_email like '%+ft-%';
//
// Writes straight to the tables (like seed-workflow-samples.mjs) — this is
// seed data, not a simulation of the approval flow.
//
// Usage:
//   node scripts/seed-empanelment-feature-samples.mjs --yes-i-am-sure-this-is-not-prod [--ci]
//
// Env (read from .env.local automatically):
//   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import readline from "node:readline/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PROD_PROJECT_REF_DENYLIST = ["REPLACE_WITH_PROD_PROJECT_REF"];

function loadDotEnvLocal() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
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
const EMAIL_BASE = process.env.DEMO_EMAIL_BASE || "priyanshu.arora.afc@gmail.com";
const [EMAIL_LOCAL, EMAIL_DOMAIN] = EMAIL_BASE.split("@");
const aliasEmail = (tag) => `${EMAIL_LOCAL}+${tag}@${EMAIL_DOMAIN}`;

const projectRefFromUrl = (url) => { try { return new URL(url).hostname.split(".")[0]; } catch { return null; } };
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const minsAgo = (n) => new Date(Date.now() - n * 6e4).toISOString();
const yearsFromNow = (n) => new Date(Date.now() + n * 365 * 864e5).toISOString();
const appCode = () => String(10000 + Math.floor(Math.random() * 90000));

function baseBaData(overrides) {
  return {
    entity_type: "Private Ltd.", year_established: 2015, reg_address: "12 Institutional Area, Lodhi Road, New Delhi 110003",
    designation: "Managing Director", companies_act_status: "Compliant", company_status: "Active",
    date_of_incorporation: "2015-04-01", core_expertise: "Agri-business advisory, rural livelihoods, M&E of development programmes.",
    sectors_served: ["Agriculture", "Livelihood"], bank_name: "HDFC Bank", bank_branch: "Lodhi Road, New Delhi",
    account_number: "50100999888777", ifsc_code: "HDFC0001234", pan: "AABCT1234C",
    net_worth: { fy22: "20", fy23: "28", fy24: "35" }, turnover: { fy22: "60", fy23: "75", fy24: "90" },
    pat: { fy22: "4", fy23: "6", fy24: "8" }, cash_flow: { fy22: "Yes", fy23: "Yes", fy24: "Yes" },
    team_size: 24, years_experience: 9,
    assignments: [{ title: "State rural livelihoods baseline survey", client: "State Rural Livelihoods Mission", duration: "14 months", value: "85 L", role: "Lead Consultant" }],
    certifications: "ISO 9001:2015", govt_empanelments: "NABARD — empanelled since 2020",
    declaration_accepted: true, documents: [],
    ...overrides,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--yes-i-am-sure-this-is-not-prod")) {
    console.error("Refusing to run without --yes-i-am-sure-this-is-not-prod.");
    process.exit(1);
  }
  const isCi = args.includes("--ci");
  // Which teams to seed onto. Default to the canonical teams; pass
  //   --teams "Team 1,Team 2"
  // to target the demo teams instead (or any comma-separated list).
  const teamsArg = args.find((a) => a.startsWith("--teams="))?.slice("--teams=".length)
    ?? (args.includes("--teams") ? args[args.indexOf("--teams") + 1] : "");
  const TEAMS = (teamsArg || "BPDD,BIID").split(",").map((t) => t.trim()).filter(Boolean);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("ERROR: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
    process.exit(1);
  }
  const targetRef = projectRefFromUrl(SUPABASE_URL);
  if (targetRef && PROD_PROJECT_REF_DENYLIST.includes(targetRef)) {
    console.error(`Refusing to run: ${SUPABASE_URL} resolves to the production project ref.`);
    process.exit(1);
  }
  console.log(`Target Supabase project: ${SUPABASE_URL} (ref: ${targetRef})`);
  console.log(`Seeding onto teams: ${TEAMS.join(", ")}`);
  if (!isCi) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Type 'y' to seed Empanelment feature-test data into this project: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") { console.log("Aborted."); process.exit(0); }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: users, error: usersErr } = await admin
    .from("afc_users")
    .select("id, full_name, role, team")
    .eq("is_active", true);
  if (usersErr) { console.error("Failed to load afc_users:", usersErr.message); process.exit(1); }

  const pool = {};
  for (const u of users) (pool[`${u.team}:${u.role}`] ||= []).push(u);
  function pick(team, role, i = 0) {
    const list = pool[`${team}:${role}`] || [];
    if (!list.length) throw new Error(`No active ${role} on team ${team}`);
    return list[i % list.length];
  }
  const anyMd = users.find((u) => u.role === "md") || null;
  for (const team of TEAMS) {
    for (const role of ["associate_consultant", "project_officer", "dgm", "agm"]) {
      if (!(pool[`${team}:${role}`]?.length)) {
        console.error(`ERROR: team "${team}" has no active ${role}. Pick different --teams or activate one.`);
        process.exit(1);
      }
    }
  }

  // ── Scenario definitions ──────────────────────────────────────────
  // advisorRole: which role fills dgm_id ("dgm" or "agm").
  const SCENARIOS = [
    {
      tag: "ft-prov-dgmreview", team: "BPDD", status: "dgm_review", advisorRole: "dgm",
      org: "TEST FT — Provisional sent, at DGM review",
      provisional: { sentAt: daysAgo(3) },
      comments: { po: true, cfoCs: true, poFinal: true },
      note: "Provisional letter icon should appear; opens the provisional PDF.",
    },
    {
      tag: "ft-prov-poreview", team: "BIID", status: "po_review", advisorRole: "agm",
      org: "TEST FT — Provisional sent early, at PO review",
      provisional: { sentAt: daysAgo(1) },
      note: "Provisional icon even at an early stage.",
    },
    {
      tag: "ft-emp-accepted", team: "BPDD", status: "accepted", advisorRole: "dgm",
      org: "TEST FT — Accepted, empanelment letter issued",
      provisional: { sentAt: daysAgo(20) },
      empanelment: { ref: `AFC/BA/${new Date().getFullYear()}/FT-1`, expiresAt: yearsFromNow(3) },
      comments: { po: true, cfoCs: true, poFinal: true, dgm: true, md: "TEST FT — approved for empanelment." },
      note: "Empanelment icon REPLACES the provisional one; opens the final MD-signed PDF.",
    },
    {
      tag: "ft-emp-noref", team: "BIID", status: "accepted", advisorRole: "agm",
      org: "TEST FT — Accepted, letter ref not persisted",
      comments: { po: true, cfoCs: true, poFinal: true, dgm: true, md: "TEST FT — approved." },
      note: "Empanelment icon shows from status=accepted even without empanelment_ref.",
    },
    {
      tag: "ft-agm-pofinal", team: "BPDD", status: "po_final_review", advisorRole: "agm",
      org: "TEST FT — AGM advisor, awaiting PO final forward",
      comments: { po: true, cfoCs: true },
      note: 'PO action card should read "Forward to AGM", not "Forward to DGM".',
    },
    {
      tag: "ft-agm-dgmreview", team: "BIID", status: "dgm_review", advisorRole: "agm",
      org: "TEST FT — AGM advisor, awaiting recommendation",
      comments: { po: true, cfoCs: true, poFinal: true },
      note: "AGM is the acting advising authority at this stage.",
    },
    {
      tag: "ft-sentback-dgm", team: "BPDD", status: "po_final_review", advisorRole: "dgm",
      org: "TEST FT — Sent back by DGM to PO",
      comments: { po: true, cfoCs: true, poFinal: true },
      sentBack: { action: "dgm_sent_back", byRole: "dgm", comment: "TEST FT — Please attach the revised CA-certified net-worth statement; the copy on file is unsigned. Also confirm the FY24 turnover figure against the audited accounts." },
      note: 'PO should see an orange "Sent Back by DGM" card above the buttons.',
    },
    {
      tag: "ft-sentback-md", team: "BIID", status: "dgm_review", advisorRole: "agm",
      org: "TEST FT — Sent back by MD to AGM",
      comments: { po: true, cfoCs: true, poFinal: true, dgm: true },
      sentBack: { action: "md_sent_back", byRole: "md", comment: "TEST FT — Clarify the 3-year turnover trend and the dip in FY23 PAT before this comes back to me for signature." },
      note: 'Advising AGM should see an orange "Sent Back by Managing Director" card.',
    },
    {
      tag: "ft-mdreview", team: "BPDD", status: "md_review", advisorRole: "dgm",
      org: "TEST FT — At MD review, DGM recommendation on file",
      comments: { po: true, cfoCs: true, poFinal: true, dgm: true },
      note: "MD should see the DGM Recommendation card above Accept / Send Back / Reject.",
    },
    {
      tag: "ft-rejected-old", team: "BIID", status: "rejected", advisorRole: "dgm",
      org: "TEST FT — Rejected ~5 months ago (date filter)",
      createdDaysAgo: 150,
      comments: { po: true, cfoCs: true, poFinal: true, dgm: true, md: "TEST FT — did not meet the empanelment threshold this cycle." },
      note: 'Falls outside "Last 3 Months" but inside "Last Year".',
    },
  ];

  const results = { created: 0, skipped: 0, failed: [] };

  const combos = [];
  for (const team of TEAMS) for (const s of SCENARIOS) combos.push({ s, team });

  for (let idx = 0; idx < combos.length; idx++) {
    const { s, team } = combos[idx];
    const teamSlug = team.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const baEmail = aliasEmail(`${s.tag}-${teamSlug}`);
    try {
      const { data: existing } = await admin.from("empanelment_applications").select("id").eq("ba_email", baEmail).maybeSingle();
      if (existing) { results.skipped++; console.log(`  = ${s.org} [${team}] — already exists, skipping`); continue; }

      const ac = pick(team, "associate_consultant", idx);
      const po = pick(team, "project_officer", idx);
      const advisor = pick(team, s.advisorRole, idx);

      const createdAt = daysAgo(s.createdDaysAgo ?? (25 - (idx % SCENARIOS.length)));
      const row = {
        application_code: appCode(), status: s.status, ba_email: baEmail, team, office: "delhi",
        sent_by: ac.id, project_officer_id: po.id, dgm_id: advisor.id,
        sent_at: createdAt, created_at: createdAt,
      };
      if (s.status !== "sent") row.form_submitted_at = daysAgo((s.createdDaysAgo ?? 25) - 2);
      if (s.comments?.po) row.po_comment = "TEST FT — technical details reviewed; capabilities are a good fit. Forwarding.";
      if (s.comments?.cfoCs) {
        row.cfo_comment = "TEST FT — financials are within norms; net worth and turnover trend acceptable.";
        row.cfo_reviewed = true;
        row.cs_comment = "TEST FT — no outstanding compliance or blacklisting concerns.";
        row.cs_reviewed = true;
      }
      if (s.comments?.poFinal) row.po_final_comment = "TEST FT — CFO/CS cleared; forwarding for recommendation.";
      if (s.comments?.dgm) row.dgm_comment = "TEST FT — capabilities and financials verified; recommended for empanelment.";
      if (s.comments?.md) { row.md_remarks = s.comments.md; row.decided_at = daysAgo(1); }
      if (s.status === "rejected" && !row.decided_at) { row.md_remarks = s.comments?.md || "TEST FT — rejected."; row.decided_at = daysAgo(s.createdDaysAgo ? s.createdDaysAgo - 5 : 1); }
      if (s.provisional) { row.provisional_letter_sent = true; row.provisional_sent_at = s.provisional.sentAt; }
      if (s.empanelment) { row.empanelment_ref = `${s.empanelment.ref}-${teamSlug}`; row.empanelment_expires_at = s.empanelment.expiresAt; }

      const { data: inserted, error: appErr } = await admin.from("empanelment_applications").insert(row).select("id").single();
      if (appErr) throw new Error(`application insert: ${appErr.message}`);
      const applicationId = inserted.id;

      const { error: regErr } = await admin.from("ba_registrations").insert({
        application_id: applicationId,
        submitted_at: row.form_submitted_at || createdAt,
        ...baseBaData({ contact_person: `Test Contact ${idx + 1}`, phone: `98${String(20000000 + idx)}`, email: baEmail }),
        org_name: s.org,
      });
      if (regErr) throw new Error(`ba_registrations insert: ${regErr.message}`);

      // ── Activity log — enough of a trail that the timeline + the new
      //    "context comments" block have something to show. Timestamps
      //    increase so the send-back entry is genuinely the newest.
      const trail = [];
      let t = 0;
      const at = () => minsAgo(600 - t++ * 30);
      trail.push({ actor_id: ac.id, actor_role: "associate_consultant", action: "sent", comment: "TEST FT — invitation sent.", created_at: createdAt });
      if (s.status !== "sent") trail.push({ actor_id: null, actor_role: "ba", action: "ba_filled", comment: `TEST FT — form submitted by ${s.org}.`, created_at: at() });
      if (s.comments?.po) trail.push({ actor_id: po.id, actor_role: po.role, action: "po_forwarded", comment: row.po_comment, created_at: at() });
      if (s.comments?.cfoCs) {
        trail.push({ actor_id: null, actor_role: "cfo", action: "cfo_reviewed", comment: row.cfo_comment, created_at: at() });
        trail.push({ actor_id: null, actor_role: "cs", action: "cs_reviewed", comment: row.cs_comment, created_at: at() });
      }
      if (s.comments?.poFinal) trail.push({ actor_id: po.id, actor_role: po.role, action: "po_final_forwarded", comment: row.po_final_comment, created_at: at() });
      if (s.comments?.dgm) trail.push({ actor_id: advisor.id, actor_role: advisor.role, action: "dgm_recommended", comment: row.dgm_comment, created_at: at() });
      if (s.sentBack) {
        trail.push({
          actor_id: s.sentBack.byRole === "md" ? (anyMd?.id ?? null) : advisor.id,
          actor_role: s.sentBack.byRole, action: s.sentBack.action, comment: s.sentBack.comment, created_at: at(),
        });
      }
      if (s.provisional) trail.push({ actor_id: advisor.id, actor_role: advisor.role, action: "provisional_letter_sent", comment: `TEST FT — provisional letter sent to ${baEmail}.`, created_at: s.provisional.sentAt });
      if (s.comments?.md) trail.push({ actor_id: anyMd?.id ?? null, actor_role: "md", action: s.status === "rejected" ? "md_rejected" : "md_accepted", comment: s.comments.md, created_at: at() });

      const { error: logErr } = await admin.from("empanelment_activity_log").insert(trail.map((e) => ({ ...e, application_id: applicationId })));
      if (logErr) throw new Error(`activity_log insert: ${logErr.message}`);

      results.created++;
      console.log(`  ✓ [${team}] ${s.org}`);
      console.log(`      status=${s.status} advisor=${advisor.full_name} (${advisor.role})`);
      console.log(`      → ${s.note}`);
    } catch (err) {
      results.failed.push({ org: `[${team}] ${s.org}`, reason: err.message });
      console.error(`  x [${team}] ${s.org}: ${err.message}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Created: ${results.created}   Skipped: ${results.skipped}   Failed: ${results.failed.length}`);
  if (results.failed.length) console.log(JSON.stringify(results.failed, null, 2));
  console.log(`\nCleanup:  delete from empanelment_applications where ba_email like '%+ft-%';`);
  console.log(`(ba_registrations + activity log rows cascade / can be cleared the same way.)`);
}

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
