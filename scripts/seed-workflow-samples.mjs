#!/usr/bin/env node
// Seeds 2 sample rows at every pipeline status/state across Empanelment,
// Lead Generation, and Proposal Preparation, using the org's REAL existing
// staff accounts (queried live, not hardcoded) — so a reviewer can browse
// every stage of all three workflows without waiting for real applications
// to progress there naturally.
//
// Every seeded row's title/org name is prefixed "TEST —" so it's easy to
// spot and bulk-delete later. Two Business Associate accounts get
// provisioned (role=business_associate) as part of the Empanelment
// "accepted" bucket, since none existed — those are then reused as the
// assigned_ba_id on every Team 1 / Team 2 lead below.
//
// Writes go straight to the tables (like seed-demo-data.mjs does for
// empanelment_applications), not through the edge functions — this is
// seed data, not a simulation of the real approval flow, so caller-auth
// checks don't apply here.
//
// Usage:
//   node scripts/seed-workflow-samples.mjs --yes-i-am-sure-this-is-not-prod [--ci]
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
const EMAIL_BASE = process.env.DEMO_EMAIL_BASE || "priyanshu.arora.afc@gmail.com";
const PASSWORD = process.env.DEMO_PASSWORD || "TestPass123!";
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

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}
function hoursAgo(n) {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}
function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function generateAppCode() {
  return String(10000 + Math.floor(Math.random() * 90000));
}

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
    const answer = await rl.question("Type 'y' to seed workflow sample data into this project: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── Load real staff so every seeded row uses valid, existing people ──
  const { data: users, error: usersErr } = await admin.from("afc_users").select("id, full_name, role, team, committee").eq("is_active", true);
  if (usersErr) { console.error("Failed to load afc_users:", usersErr.message); process.exit(1); }

  const byTeamRole = {}; // "Team 1:project_officer" -> [users]
  for (const u of users) {
    const key = `${u.team || "none"}:${u.role}`;
    (byTeamRole[key] ||= []).push(u);
  }
  function teamRole(team, role, idx = 0) {
    const list = byTeamRole[`${team}:${role}`] || [];
    if (!list.length) throw new Error(`No active ${role} found on team ${team}`);
    return list[idx % list.length];
  }
  function approvalAuthority(team, idx = 0) {
    const list = users.filter((u) => u.team === team && ["agm", "srm", "dgm"].includes(u.role));
    if (!list.length) throw new Error(`No AGM/SRM/DGM found on team ${team}`);
    return list[idx % list.length];
  }
  const pmtMember = users.find((u) => u.committee === "PMT");
  const pmtExtendedMember = users.find((u) => u.committee === "PMT Extended");
  const g3Member = users.find((u) => u.committee === "G3");
  const md = users.find((u) => u.role === "md");
  if (!pmtMember || !pmtExtendedMember || !g3Member || !md) {
    console.error("Missing a required org-wide committee member or MD — cannot seed lead workflow.");
    process.exit(1);
  }

  const results = { empanelment: { created: 0, skipped: 0, failed: [] }, leads: { created: 0, failed: [] }, proposals: { created: 0, failed: [] }, baAccounts: [] };

  // ══════════════════════════════════════════════════════════════════
  // EMPANELMENT — 2 applications per status (10 statuses)
  // ══════════════════════════════════════════════════════════════════
  console.log("\n=== Empanelment: seeding 2 applications per status ===");
  const EMP_TEAMS = ["Team 1", "Team 2"];
  const EMP_STATUSES = ["sent", "filled", "po_review", "cfo_cs_review", "po_final_review", "dgm_review", "md_review", "on_hold", "accepted", "rejected"];

  function baseBaData(overrides) {
    return {
      entity_type: "Private Ltd.", year_established: 2015, reg_address: "Sample Address, New Delhi",
      designation: "Managing Partner", companies_act_status: "Compliant", company_status: "Active",
      date_of_incorporation: "2015-04-01", core_expertise: "Agri-business advisory",
      sectors_served: ["Agriculture"], bank_name: "HDFC Bank", bank_branch: "New Delhi",
      account_number: "50100999888777", ifsc_code: "HDFC0001234", pan: "AABCT1234C",
      net_worth: { fy22: "20", fy23: "28", fy24: "35" }, turnover: { fy22: "60", fy23: "75", fy24: "90" },
      pat: { fy22: "4", fy23: "6", fy24: "8" }, cash_flow: { fy22: "Yes", fy23: "Yes", fy24: "Yes" },
      team_size: 8, years_experience: 6,
      assignments: [{ title: "Sample rural development assignment", client: "State Dept.", duration: "12 months", value: "50 L", role: "Consultant" }],
      declaration_accepted: true, documents: [], ...overrides,
    };
  }

  let empIdx = 0;
  for (const status of EMP_STATUSES) {
    for (let i = 0; i < 2; i++) {
      empIdx++;
      const team = EMP_TEAMS[empIdx % EMP_TEAMS.length];
      const baTag = `wf-emp-${status}-${i + 1}`;
      const baEmail = aliasEmail(baTag);
      const orgName = `TEST — Sample BA ${status.replace(/_/g, " ")} ${i + 1}`;
      try {
        const { data: existing } = await admin.from("empanelment_applications").select("id").eq("ba_email", baEmail).maybeSingle();
        if (existing) { results.empanelment.skipped++; console.log(`  = ${orgName} already exists, skipping`); continue; }

        const ac = teamRole(team, "associate_consultant", i);
        const po = teamRole(team, "project_officer", 0);
        const dgm = teamRole(team, "dgm", 0);

        const sentAt = daysAgo(20 - empIdx % 15);
        const insertRow = {
          application_code: generateAppCode(), status, ba_email: baEmail, team,
          office: team === "Team 1" || team === "Team 2" ? "delhi" : null,
          sent_by: ac.id, project_officer_id: po.id, dgm_id: dgm.id,
          sent_at: sentAt, created_at: sentAt,
        };
        const filled = status !== "sent";
        if (filled) insertRow.form_submitted_at = daysAgo(15 - empIdx % 10);
        if (["cfo_cs_review", "po_final_review", "dgm_review", "md_review", "accepted", "rejected"].includes(status)) {
          insertRow.po_comment = "TEST — reviewed and forwarded.";
        }
        if (["po_final_review", "dgm_review", "md_review", "accepted", "rejected"].includes(status)) {
          insertRow.cfo_comment = "TEST — financials acceptable."; insertRow.cfo_reviewed = true;
          insertRow.cs_comment = "TEST — no compliance concerns."; insertRow.cs_reviewed = true;
          insertRow.po_final_comment = "TEST — forwarding to DGM.";
        }
        if (["md_review", "accepted", "rejected"].includes(status)) {
          insertRow.dgm_comment = "TEST — recommended for empanelment.";
        }
        if (status === "on_hold") insertRow.hold_origin_status = "po_review";
        if (status === "accepted") {
          insertRow.md_remarks = "TEST — approved for empanelment.";
          insertRow.decided_at = daysAgo(1);
          insertRow.empanelment_ref = `AFC/BA/TEST/${team.replace(/\s/g, "")}-${i + 1}`;
          insertRow.empanelment_expires_at = new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
        }
        if (status === "rejected") {
          insertRow.md_remarks = "TEST — did not meet empanelment threshold.";
          insertRow.decided_at = daysAgo(1);
        }

        const { data: inserted, error: appErr } = await admin.from("empanelment_applications").insert(insertRow).select("id").single();
        if (appErr) throw new Error(`insert failed: ${appErr.message}`);
        const applicationId = inserted.id;

        if (filled) {
          const { error: regErr } = await admin.from("ba_registrations").insert({
            application_id: applicationId, submitted_at: insertRow.form_submitted_at,
            ...baseBaData({ contact_person: `Test Contact ${empIdx}`, phone: "98" + String(10000000 + empIdx) }),
            org_name: orgName, email: baEmail,
          });
          if (regErr) throw new Error(`ba_registrations insert failed: ${regErr.message}`);
        }

        if (status === "on_hold") {
          await admin.from("compliance_flags").insert({
            application_id: applicationId, hold_batch_id: crypto.randomUUID(),
            field_key: "pan", field_label: "PAN Number", raised_by: po.id, raised_by_role: "project_officer",
            comment: "TEST — PAN needs re-verification.", status: "open",
          });
        }

        await admin.from("empanelment_activity_log").insert({
          application_id: applicationId, actor_id: ac.id, actor_role: "associate_consultant",
          action: "sent", comment: "TEST — seed data.", created_at: sentAt,
        });

        let baPortalEmail = null;
        if (status === "accepted") {
          const { data: baAuthUser, error: baAuthErr } = await admin.auth.admin.createUser({ email: baEmail, password: PASSWORD, email_confirm: true });
          if (baAuthErr || !baAuthUser?.user) {
            console.error(`  ! ${orgName}: BA account creation failed: ${baAuthErr?.message}`);
          } else {
            const { error: baProfileErr } = await admin.from("afc_users").insert({
              id: baAuthUser.user.id, full_name: orgName.replace("TEST — Sample BA ", "TEST BA — "), email: baEmail,
              role: "business_associate", team, is_active: true, must_change_password: false,
            });
            if (baProfileErr) {
              await admin.auth.admin.deleteUser(baAuthUser.user.id).catch(() => {});
              console.error(`  ! ${orgName}: BA profile insert failed: ${baProfileErr.message}`);
            } else {
              await admin.from("empanelment_applications").update({ ba_user_id: baAuthUser.user.id }).eq("id", applicationId);
              baPortalEmail = baEmail;
              results.baAccounts.push({ id: baAuthUser.user.id, team, email: baEmail, orgName });
            }
          }
        }

        results.empanelment.created++;
        console.log(`  ✓ ${orgName} (${status}, ${team})${baPortalEmail ? " — BA portal login created" : ""}`);
      } catch (err) {
        results.empanelment.failed.push({ orgName, reason: err.message });
        console.error(`  x ${orgName}: ${err.message}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // LEADS — 2 per status (9 statuses), plus 16 dedicated to Proposal Prep
  // ══════════════════════════════════════════════════════════════════
  console.log("\n=== Lead Generation: seeding sample leads ===");
  const LEAD_TEAMS = ["Team 1", "Team 2"];
  const ba1 = results.baAccounts.find((b) => b.team === "Team 1");
  const ba2 = results.baAccounts.find((b) => b.team === "Team 2");
  function baFor(team) {
    return team === "Team 1" ? ba1 : team === "Team 2" ? ba2 : null;
  }

  async function nextLeadNumber() {
    const { data, error } = await admin.rpc("next_lead_number");
    if (error) throw new Error(`next_lead_number failed: ${error.message}`);
    return data;
  }

  async function insertLead({ titleSuffix, team, idx, status, extra = {} }) {
    const lead_number = await nextLeadNumber();
    const pr = teamRole(team, "project_assistant", idx);
    const reviewer = teamRole(team, "associate_consultant", idx);
    const aa = approvalAuthority(team, idx);
    const creator = teamRole(team, "associate_consultant", idx + 1);
    const submittedAt = daysAgo(10 + idx);
    const row = {
      lead_number, lead_type: "rfp", source: "in_house",
      title: `TEST — ${titleSuffix}`,
      portal_name: "GeM", bid_number: `TEST-BID-${lead_number}`,
      client_name: "Test Client Department", state: "Delhi",
      submission_deadline: daysFromNow(20 + idx), delivery_type: "online",
      remark: "TEST — seed data for workflow testing.",
      team, created_by: creator.id, person_responsible_id: pr.id, reviewer_id: reviewer.id,
      approval_authority_id: aa.id, status, submitted_at: submittedAt, created_at: submittedAt,
      ...extra,
    };
    const { data: inserted, error } = await admin.from("leads").insert(row).select("id").single();
    if (error) throw new Error(`lead insert failed: ${error.message}`);
    await admin.from("lead_activity_log").insert({
      lead_id: inserted.id, actor_id: creator.id, actor_role: creator.role,
      action: "seeded", to_status: status, comment: "TEST — seed data, lead created directly at this status for workflow testing.",
      created_at: submittedAt,
    });
    return { id: inserted.id, lead_number, pr, reviewer, aa };
  }

  const leadIdsByBucket = {};
  async function seedLeadBucket(bucketKey, status, extraFn) {
    leadIdsByBucket[bucketKey] = [];
    for (let i = 0; i < 2; i++) {
      const team = LEAD_TEAMS[i % LEAD_TEAMS.length];
      const titleSuffix = `${bucketKey.replace(/_/g, " ")} sample ${i + 1}`;
      try {
        const extra = extraFn ? extraFn(team, i) : {};
        const lead = await insertLead({ titleSuffix, team, idx: i, status, extra });
        leadIdsByBucket[bucketKey].push({ ...lead, team });
        results.leads.created++;
        console.log(`  ✓ ${lead.lead_number} — ${titleSuffix} (${status}, ${team})`);
      } catch (err) {
        results.leads.failed.push({ titleSuffix, reason: err.message });
        console.error(`  x ${titleSuffix}: ${err.message}`);
      }
    }
  }

  await seedLeadBucket("pa_review", "pa_review", () => ({}));
  await seedLeadBucket("pmt_review", "pmt_review", (team) => ({ assigned_ba_id: baFor(team)?.id || null }));
  await seedLeadBucket("pmt_extended_review", "pmt_extended_review", (team) => ({ assigned_ba_id: baFor(team)?.id || null }));
  await seedLeadBucket("dgm_review", "dgm_review", (team) => ({ assigned_ba_id: baFor(team)?.id || null }));
  await seedLeadBucket("md_review", "md_review", (team, i) => ({
    assigned_ba_id: baFor(team)?.id || null,
    handled_by_dgm_id: i === 0 ? g3Member.id : null, // one arrived via DGM, one via straight PMT approval
  }));
  await seedLeadBucket("pa_action_required", "pa_action_required", (team) => ({
    assigned_ba_id: baFor(team)?.id || null,
  }));
  await seedLeadBucket("pa_dropped", "pa_dropped", (team) => ({
    assigned_ba_id: baFor(team)?.id || null, decided_at: hoursAgo(6),
  }));
  await seedLeadBucket("md_declined", "md_declined", (team) => ({
    assigned_ba_id: baFor(team)?.id || null, decided_at: hoursAgo(4),
  }));

  // 16 md_approved leads dedicated to Proposal Preparation states below.
  const PROPOSAL_BUCKETS = [
    "not_opened", "fee_note_draft", "fee_note_pending_md", "fee_note_approved",
    "fee_note_rejected", "locked", "outcome_awarded", "outcome_rejected",
  ];
  for (const bucket of PROPOSAL_BUCKETS) {
    await seedLeadBucket(`proposal_${bucket}`, "md_approved", (team) => ({
      assigned_ba_id: baFor(team)?.id || null, decided_at: daysAgo(2),
    }));
  }

  // ══════════════════════════════════════════════════════════════════
  // PROPOSAL PREPARATION — one state per dedicated md_approved lead pair
  // ══════════════════════════════════════════════════════════════════
  console.log("\n=== Proposal Preparation: seeding sample proposals ===");

  async function openProposal(leadId, createdBy) {
    const { data, error } = await admin.from("proposal_preparations").insert({ lead_id: leadId, created_by: createdBy }).select("id").single();
    if (error) throw new Error(`proposal_preparations insert failed: ${error.message}`);
    return data.id;
  }
  async function addFeeNote(proposalId, { noteType, status, createdBy, mdRemark }) {
    const row = {
      proposal_id: proposalId, note_type: noteType, amount: 75000, justification: "TEST — seed data justification.",
      status, created_by: createdBy,
    };
    if (status === "approved" || status === "rejected") {
      row.md_decided_by = md.id; row.md_decided_at = hoursAgo(2); row.md_remark = mdRemark;
    }
    const { data, error } = await admin.from("fee_notes").insert(row).select("id").single();
    if (error) throw new Error(`fee_notes insert failed: ${error.message}`);
    if (status !== "draft") {
      await admin.from("fee_note_events").insert({
        fee_note_id: data.id, actor_id: createdBy, actor_name: "TEST seed",
        action: status === "pending_md" ? "submitted" : status === "approved" ? "md_approved" : "md_rejected",
        remark: mdRemark || null,
      });
    }
    return data.id;
  }

  for (const bucket of PROPOSAL_BUCKETS) {
    const leads = leadIdsByBucket[`proposal_${bucket}`] || [];
    for (const lead of leads) {
      try {
        const proposalId = await openProposal(lead.id, lead.pr.id);
        if (bucket === "fee_note_draft") {
          await addFeeNote(proposalId, { noteType: "emd", status: "draft", createdBy: lead.pr.id });
        } else if (bucket === "fee_note_pending_md") {
          await addFeeNote(proposalId, { noteType: "tender_fee", status: "pending_md", createdBy: lead.pr.id });
        } else if (bucket === "fee_note_approved") {
          await addFeeNote(proposalId, { noteType: "emd", status: "approved", createdBy: lead.pr.id, mdRemark: "TEST — approved." });
        } else if (bucket === "fee_note_rejected") {
          await addFeeNote(proposalId, { noteType: "pbg", status: "rejected", createdBy: lead.pr.id, mdRemark: "TEST — please revise justification." });
        } else if (bucket === "locked") {
          await addFeeNote(proposalId, { noteType: "emd", status: "approved", createdBy: lead.pr.id, mdRemark: "TEST — approved." });
          await admin.from("proposal_preparations").update({ locked: true, locked_at: hoursAgo(1), locked_by: lead.pr.id, lock_reason: "manual" }).eq("id", proposalId);
        } else if (bucket === "outcome_awarded") {
          await addFeeNote(proposalId, { noteType: "emd", status: "approved", createdBy: lead.pr.id, mdRemark: "TEST — approved." });
          await admin.from("proposal_preparations").update({
            locked: true, locked_at: hoursAgo(3), locked_by: lead.pr.id, lock_reason: "manual",
            client_response: "awarded", client_response_at: hoursAgo(1), client_response_by: lead.pr.id,
            client_response_remark: "TEST — contract awarded.",
          }).eq("id", proposalId);
        } else if (bucket === "outcome_rejected") {
          await addFeeNote(proposalId, { noteType: "emd", status: "approved", createdBy: lead.pr.id, mdRemark: "TEST — approved." });
          await admin.from("proposal_preparations").update({
            locked: true, locked_at: hoursAgo(3), locked_by: lead.pr.id, lock_reason: "manual",
            client_response: "rejected", client_response_at: hoursAgo(1), client_response_by: lead.pr.id,
            client_response_remark: "TEST — client selected another firm.",
          }).eq("id", proposalId);
        }
        // A couple of proposals also get a BA doc request + checklist item, for panel visibility.
        if (bucket === "fee_note_pending_md" || bucket === "locked") {
          await admin.from("proposal_document_requests").insert({
            proposal_id: proposalId, item_name: "TEST — GST Certificate", justification: "TEST — required for submission.", created_by: lead.pr.id,
          });
          await admin.from("proposal_afc_checklist_items").insert({
            proposal_id: proposalId, item_name: "TEST — Annexure III Undertaking", status: "pending", created_by: lead.pr.id,
          });
        }
        results.proposals.created++;
        console.log(`  ✓ Proposal for ${lead.lead_number} (${bucket})`);
      } catch (err) {
        results.proposals.failed.push({ leadNumber: lead.lead_number, reason: err.message });
        console.error(`  x Proposal for ${lead.lead_number}: ${err.message}`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  console.log(`Empanelment: ${results.empanelment.created} created, ${results.empanelment.skipped} skipped, ${results.empanelment.failed.length} failed`);
  console.log(`Leads:       ${results.leads.created} created, ${results.leads.failed.length} failed`);
  console.log(`Proposals:   ${results.proposals.created} created, ${results.proposals.failed.length} failed`);
  console.log(`BA accounts provisioned: ${results.baAccounts.map((b) => b.email).join(", ") || "none"}`);
  if (results.empanelment.failed.length) console.log("\nEmpanelment failures:", JSON.stringify(results.empanelment.failed, null, 2));
  if (results.leads.failed.length) console.log("\nLead failures:", JSON.stringify(results.leads.failed, null, 2));
  if (results.proposals.failed.length) console.log("\nProposal failures:", JSON.stringify(results.proposals.failed, null, 2));
  console.log("\nAll seeded rows are prefixed 'TEST —' for easy identification/cleanup.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
