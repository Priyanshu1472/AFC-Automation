#!/usr/bin/env node
// Seeds 4 fully-filled, MD-approved leads (2 on "Team 1", 2 on "Team 2" —
// the dedicated test-user teams, never real staff) with a complete,
// LOCKED proposal each: approved fee note, a proposed value, and a
// supporting document row — i.e. everything lock-proposal's own
// lockBlockers() requires, already done. Each proposal's client_response
// is left "pending", so opening it in the app shows the "What did the
// client decide?" Awarded / Not Awarded prompt immediately, ready to test
// that exact step of the workflow.
//
// Writes straight to the tables, like seed-workflow-samples.mjs does —
// this is seed data, not a simulation of the real approval pipeline, so
// caller-auth checks don't apply.
//
// Every seeded title is prefixed "TEST —" for easy spotting/cleanup. The
// one proposal_documents row per proposal points at a storage path that
// was never actually uploaded — fine for exercising the lock/outcome UI,
// but "View"/"Download" on that one document will fail; swap in a real
// upload first if that matters for your test.
//
// Usage:
//   node scripts/seed-proposal-test-leads.mjs --yes-i-am-sure-this-is-not-prod [--ci]
//
// Required env vars — read from .env.local automatically:
//   SUPABASE_URL (falls back to VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import readline from "node:readline/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Same convention as the other seed scripts — fill this in with the real
// prod project ref if/when one exists, so this can never accidentally run
// there even with the flag passed.
const PROD_PROJECT_REF_DENYLIST = ["REPLACE_WITH_PROD_PROJECT_REF"];

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

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}
function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// What each seeded lead needs — one per team, times 2 teams.
const SAMPLES = [
  {
    team: "Team 1",
    title: "Smart City Water Supply Master Plan",
    client_name: "Municipal Corporation of Test City",
    bid_number: "T1-WSS-2026-014",
    state: "Delhi",
    value: 8500000,
  },
  {
    team: "Team 1",
    title: "District Irrigation Modernisation DPR",
    client_name: "Department of Irrigation, Test State",
    bid_number: "T1-IRR-2026-021",
    state: "Haryana",
    value: 4200000,
  },
  {
    team: "Team 2",
    title: "Rural Road Connectivity PMGSY Phase III Consultancy",
    client_name: "PWD (Rural), Test State",
    bid_number: "T2-ROAD-2026-009",
    state: "Uttar Pradesh",
    value: 6300000,
  },
  {
    team: "Team 2",
    title: "Solid Waste Management PPP Transaction Advisory",
    client_name: "Test City Municipal Council",
    bid_number: "T2-SWM-2026-033",
    state: "Maharashtra",
    value: 9750000,
  },
];

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes-i-am-sure-this-is-not-prod");
  const isCi = args.includes("--ci");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("ERROR: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set (add to .env.local).");
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
  if (!isCi) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Type 'y' to seed 4 locked, ready-for-outcome proposals into this project: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── Pick the dedicated test users for each team — never real staff ──
  const { data: users, error: usersErr } = await admin
    .from("afc_users")
    .select("id, full_name, role, team")
    .in("team", ["Team 1", "Team 2"])
    .eq("is_active", true);
  if (usersErr) { console.error("Failed to load afc_users:", usersErr.message); process.exit(1); }

  function pick(team, role) {
    const u = users.find((u) => u.team === team && u.role === role);
    if (!u) throw new Error(`No active ${role} found on ${team} — did seed-test-users.mjs run?`);
    return u;
  }
  const { data: baUsers, error: baErr } = await admin.from("afc_users").select("id, team").eq("role", "business_associate").in("team", ["Team 1", "Team 2"]).eq("is_active", true);
  if (baErr) { console.error("Failed to load business partners:", baErr.message); process.exit(1); }
  function baFor(team) {
    return (baUsers || []).find((b) => b.team === team)?.id || null;
  }

  async function nextLeadNumber(team) {
    const { data, error } = await admin.rpc("next_lead_number", { p_team: team });
    if (error) throw new Error(`next_lead_number failed: ${error.message}`);
    return data;
  }

  const results = { created: 0, failed: [] };

  for (const sample of SAMPLES) {
    const titleFull = `TEST — ${sample.title}`;
    try {
      const { data: existing } = await admin.from("leads").select("id").eq("title", titleFull).eq("team", sample.team).maybeSingle();
      if (existing) { console.log(`  = ${titleFull} already exists, skipping`); continue; }

      const pr = pick(sample.team, "project_officer");
      const reviewer = pick(sample.team, "dgm");
      const ra = pick(sample.team, "agm");
      const creator = pick(sample.team, "associate_consultant");
      const assignedBaId = baFor(sample.team);

      const lead_number = await nextLeadNumber(sample.team);
      const submittedAt = daysAgo(12);
      const { data: lead, error: leadErr } = await admin.from("leads").insert({
        lead_number, lead_type: "rfp", source: "in_house",
        title: titleFull,
        portal_name: "GeM", bid_number: `TEST-${sample.bid_number}`,
        client_name: sample.client_name, state: sample.state,
        submission_deadline: daysFromNow(45), delivery_type: "online",
        remark: "TEST — seed data for testing the Proposal Preparation Awarded/Not Awarded workflow.",
        team: sample.team, created_by: creator.id,
        person_responsible_id: pr.id, reviewer_id: reviewer.id, recommending_authority_id: ra.id,
        assigned_ba_id: assignedBaId,
        status: "md_approved",
        submitted_at: submittedAt, decided_at: daysAgo(2),
        approval_note_data: {
          nature_of_lead: "Nomination",
          financial_requirement: { emd: "500000", document_fee: "10000", processing_fee: "5000", pbg: "0" },
        },
        chat_opened_at: submittedAt,
      }).select("id, lead_number").single();
      if (leadErr) throw new Error(`lead insert failed: ${leadErr.message}`);

      await admin.from("lead_activity_log").insert({
        lead_id: lead.id, actor_id: creator.id, actor_role: creator.role,
        action: "seeded", to_status: "md_approved",
        comment: "TEST — seed data, created directly at md_approved to test Proposal Preparation.",
        created_at: submittedAt,
      });

      const { data: proposal, error: propErr } = await admin.from("proposal_preparations").insert({
        lead_id: lead.id, created_by: pr.id, chat_opened_at: submittedAt,
        proposed_value: sample.value,
        proposed_value_updated_at: daysAgo(2), proposed_value_updated_by: pr.id,
        locked: true, locked_at: daysAgo(1), locked_by: pr.id, lock_reason: "manual",
        // client_response left at its default ("pending") — this is the
        // whole point: opening the proposal shows the Awarded/Not Awarded
        // prompt immediately, nothing else left to fill in first.
      }).select("id").single();
      if (propErr) throw new Error(`proposal_preparations insert failed: ${propErr.message}`);

      const { error: feeErr } = await admin.from("fee_notes").insert({
        proposal_id: proposal.id,
        emd_amount: 500000, emd_borne_by: "afc", emd_payment_mode: "online",
        tender_fee_amount: 10000, tender_fee_borne_by: "afc", tender_fee_payment_mode: "online",
        processing_fee_amount: 5000, processing_fee_borne_by: "afc", processing_fee_payment_mode: "online",
        submit_to: sample.client_name, client_address: "Test Address, " + sample.state,
        client_telephone: "011-23456789", client_email: "procurement@testclient.example.gov.in",
        implementation_arrangements: "TEST — seed data.",
        justification: "TEST — seed data justification for the Bid Payment Requisition Note.",
        status: "approved",
        pr_signed_by: pr.id, pr_signed_at: daysAgo(3),
        ra_signed_by: ra.id, ra_signed_at: daysAgo(3),
        md_decided_by: creator.id, md_decided_at: daysAgo(2), md_remark: "TEST — approved for seed/testing.",
        created_by: pr.id,
      });
      if (feeErr) throw new Error(`fee_notes insert failed: ${feeErr.message}`);

      // Satisfies lockBlockers()'s "at least one document" check. Points
      // at a path nothing actually uploaded to — see module comment.
      const { error: docErr } = await admin.from("proposal_documents").insert({
        proposal_id: proposal.id, doc_type: "proposal",
        file_name: "TEST-Technical-Proposal.pdf",
        file_path: `${proposal.id}/TEST-Technical-Proposal.pdf`,
        file_size: 0, uploaded_by: pr.id,
      });
      if (docErr) throw new Error(`proposal_documents insert failed: ${docErr.message}`);

      results.created++;
      console.log(`  ✓ ${lead.lead_number} — ${titleFull} (${sample.team}) — locked, awaiting Awarded/Not Awarded`);
    } catch (err) {
      results.failed.push({ title: titleFull, reason: err.message });
      console.error(`  x ${titleFull}: ${err.message}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Created: ${results.created}, Failed: ${results.failed.length}`);
  if (results.failed.length) console.log(JSON.stringify(results.failed, null, 2));
  console.log("\nAll seeded leads are prefixed 'TEST —' and live on Team 1 / Team 2 for easy spotting/cleanup.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
