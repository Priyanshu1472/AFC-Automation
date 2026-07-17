#!/usr/bin/env node
// Seeds test staff accounts directly via the Supabase Admin API, bypassing
// email entirely — for automated E2E tests. NEVER intended to run against
// production; see the hard denylist check below, which is the real
// backstop (the --yes-i-am-sure-this-is-not-prod flag is just a speed
// bump on top of it).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/seed-test-users.mjs --yes-i-am-sure-this-is-not-prod [--ci]
//
// Required env vars (never the anon key — this needs admin privileges):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import readline from "node:readline/promises";

// Fill this in once the production Supabase project exists (see
// supabase/config.toml or the Supabase dashboard for the project ref).
// This check is unconditional — it ignores every CLI flag.
const PROD_PROJECT_REF_DENYLIST = ["REPLACE_WITH_PROD_PROJECT_REF"];

const TEST_USERS = [
  { emailLocal: "md", full_name: "Test MD", role: "md" },
  { emailLocal: "cfo", full_name: "Test CFO", role: "cfo" },
  { emailLocal: "cs", full_name: "Test CS", role: "cs" },
  { emailLocal: "dgm", full_name: "Test DGM", role: "dgm", team: "BPDD", office: "delhi" },
  { emailLocal: "agm", full_name: "Test AGM", role: "agm", team: "BPDD", office: "delhi" },
  { emailLocal: "srm", full_name: "Test SRM", role: "srm", team: "BPDD", office: "delhi" },
  { emailLocal: "po", full_name: "Test PO", role: "project_officer", team: "BPDD", office: "delhi" },
  { emailLocal: "ac", full_name: "Test AC", role: "associate_consultant", team: "BPDD", office: "delhi" },
];

const TEST_PASSWORD = "TestPass123!";

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes-i-am-sure-this-is-not-prod");
  const isCi = args.includes("--ci");

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }

  const targetRef = projectRefFromUrl(supabaseUrl);

  // Unconditional — not skippable by any flag.
  if (targetRef && PROD_PROJECT_REF_DENYLIST.includes(targetRef)) {
    console.error(`Refusing to run: ${supabaseUrl} resolves to the production project ref.`);
    process.exit(1);
  }

  if (!confirmed) {
    console.error("Refusing to run without --yes-i-am-sure-this-is-not-prod.");
    process.exit(1);
  }

  console.log(`Target Supabase project: ${supabaseUrl} (ref: ${targetRef})`);

  if (!isCi) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Type 'y' to seed test users into this project: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const emailDomain = process.env.SEED_EMAIL_DOMAIN || "example.com";

  for (const u of TEST_USERS) {
    const email = `${u.emailLocal}@${emailDomain}`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (createErr) {
      console.error(`  ✗ ${email}: ${createErr.message}`);
      continue;
    }
    const { error: insertErr } = await admin.from("afc_users").insert({
      id: created.user.id,
      full_name: u.full_name,
      email,
      role: u.role,
      team: u.team || null,
      office: u.office || null,
      is_active: true,
      must_change_password: false,
    });
    if (insertErr) {
      console.error(`  ✗ ${email} (profile insert): ${insertErr.message}`);
      await admin.auth.admin.deleteUser(created.user.id);
      continue;
    }
    console.log(`  ✓ ${email} (${u.role})`);
  }

  console.log(`Done. All test accounts use password: ${TEST_PASSWORD}`);
}

main();
