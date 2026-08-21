import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

const CALLER_ID = "caller-1";
const LEAD_ID = "lead-1";
const TEAM = "BPDD";

// Every PIN-gated action test goes through req(), which already attaches a
// valid PIN by default — tests that care about PIN behavior specifically
// (see the "PIN gate" section) override it explicitly.
const CALLER_PIN = "5432";
const CALLER_PIN_HASH = await hashPin(CALLER_PIN, CALLER_ID);

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: TEAM, office: "delhi", committee: null, is_active: true, email: "caller@afc.com", pin_hash: CALLER_PIN_HASH, ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, lead_number: "LH-2026-000001", title: "Test Lead", status: "pa_review", team: TEAM,
    created_by: "creator-1", person_responsible_id: CALLER_ID, reviewer_id: "reviewer-1",
    approval_authority_id: "authority-1", handled_by_dgm_id: null,
    // Present by default since the Lead Approval Note is a precondition for
    // "accept" — tests specifically covering that precondition override it
    // back to null.
    approval_note_data: { nature_of_lead: "Nomination" },
    ...overrides,
  };
}

// leads is queried twice per successful call: the initial fetch, then the
// guarded update+select. `updateResult` defaults to a successful single-row
// match; pass `{ data: null, error: null }` to simulate the concurrent
// no-rows-matched case. Authorization now comes straight off the caller row
// (role/team/committee) — no extra queries needed for the caller's own
// permissions, only for notification fan-out (afc_users, left at fake
// defaults since it doesn't affect status codes).
function buildClient(opts: {
  caller?: Record<string, unknown>;
  lead?: Record<string, unknown>;
  updateResult?: FakeResult;
  routes?: Record<string, FakeResult[]>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  // First call is getCallerProfile (a single row); every call after that is
  // notification fan-out (getOrgWideHolders/getPaTierHolders), which
  // expects an array — the fake repeats its last queued entry once
  // exhausted, so keep that repeating entry array-shaped.
  routes.afc_users = [{ data: opts.caller ?? callerRow(), error: null }, { data: [], error: null }, ...(routes.afc_users || [])];
  routes.leads = [
    { data: opts.lead ?? leadRow(), error: null },
    opts.updateResult ?? { data: { id: LEAD_ID }, error: null },
    ...(routes.leads || []),
  ];
  return createFakeAdminClient(routes);
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/advance-lead-stage", { token: fakeJwt({ sub: CALLER_ID }), body: { pin: CALLER_PIN, ...body } });
}

Deno.test("handleRequest - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), buildClient({}) as never);
  assertEquals(res.status, 405);
});

Deno.test("handleRequest - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("handleRequest - unknown lead -> 404", async () => {
  const client = createFakeAdminClient({ afc_users: [{ data: callerRow(), error: null }], leads: [{ data: null, error: null }] });
  const res = await handleRequest(req({ lead_id: "nope", action: "accept" }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - action invalid for current status -> 400", async () => {
  const client = buildClient({ lead: leadRow({ status: "md_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 400);
});

// ── accept / drop ────────────────────────────────────────────
Deno.test("accept - rejects a caller who isn't Person Responsible", async () => {
  const client = buildClient({ lead: leadRow({ person_responsible_id: "someone-else" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("accept - requires the Lead Approval Note to be generated first", async () => {
  const client = buildClient({ lead: leadRow({ approval_note_data: null, assigned_ba_id: "existing-ba" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Generate the Lead Approval Note before submitting for DGM approval.");
});

Deno.test("accept - success moves to dgm_initial_review when the lead already has a BA", async () => {
  const client = buildClient({ lead: leadRow({ assigned_ba_id: "existing-ba" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "dgm_initial_review" });
});

Deno.test("accept - requires a BA when the lead has none and none is provided", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Select a BA");
});

Deno.test("accept - rejects a BA from a different team", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null },
      { data: { id: "ba-9", role: "business_associate", team: "OtherTeam", is_active: true }, error: null },
    ],
    leads: [{ data: leadRow(), error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept", assigned_ba_id: "ba-9" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("accept - accepts and assigns a BA when caller selects one", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null },
      { data: { id: "ba-9", role: "business_associate", team: TEAM, is_active: true }, error: null },
      { data: [], error: null },
    ],
    leads: [{ data: leadRow(), error: null }, { data: { id: LEAD_ID }, error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept", assigned_ba_id: "ba-9" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "dgm_initial_review" });
});

// ── DGM initial review (new first-line gate, ahead of PMT) ──
Deno.test("dgm_initial_approve - rejects a caller without the G3 committee", async () => {
  const client = buildClient({ caller: callerRow({ committee: null }), lead: leadRow({ status: "dgm_initial_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_initial_approve", comment: "looks good" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("dgm_initial_approve - requires a comment", async () => {
  const client = buildClient({ caller: callerRow({ committee: "G3" }), lead: leadRow({ status: "dgm_initial_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_initial_approve" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("dgm_initial_approve - success moves to pmt_review", async () => {
  const client = buildClient({ caller: callerRow({ committee: "G3" }), lead: leadRow({ status: "dgm_initial_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_initial_approve", comment: "looks good" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pmt_review");
});

Deno.test("dgm_initial_decline - requires a reason and returns to pa_action_required", async () => {
  const client = buildClient({ caller: callerRow({ committee: "G3" }), lead: leadRow({ status: "dgm_initial_review" }) });
  const missingReason = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_initial_decline" }), client as never);
  assertEquals(missingReason.status, 400);

  const client2 = buildClient({ caller: callerRow({ committee: "G3" }), lead: leadRow({ status: "dgm_initial_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_initial_decline", comment: "not viable" }), client2 as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pa_action_required");
});

// "drop" (true, no-reassignment withdrawal) is creator-only at pa_review —
// a non-creator PR must use "reject_reassign" instead.
Deno.test("drop - a non-creator (even the PR) can't drop at pa_review", async () => {
  const client = buildClient({}); // default leadRow: caller is PR, "creator-1" is the creator
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("drop - a self-assigned creator (creator === PR) drops directly to pa_dropped", async () => {
  const client = buildClient({ lead: leadRow({ created_by: CALLER_ID, person_responsible_id: CALLER_ID }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_dropped" });
});

Deno.test("drop - the creator can drop at pa_review even when PR is someone else", async () => {
  const client = buildClient({ lead: leadRow({ created_by: CALLER_ID, person_responsible_id: "someone-else" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_dropped" });
});

Deno.test("drop - the creator can withdraw a lead already at pmt_review", async () => {
  const client = buildClient({ lead: leadRow({ status: "pmt_review", created_by: CALLER_ID }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_dropped" });
});

Deno.test("drop - the current Person Responsible (not creator) can also withdraw a lead at pmt_review", async () => {
  // default leadRow: person_responsible_id === CALLER_ID, created_by is someone else
  const client = buildClient({ lead: leadRow({ status: "pmt_review", created_by: "someone-else" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_dropped" });
});

Deno.test("drop - a bystander (neither creator nor PR) can't withdraw a lead at pmt_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "pmt_review", created_by: "someone-else", person_responsible_id: "someone-else-2" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("drop - creator (not Person Responsible) can drop a pa_action_required lead", async () => {
  const client = buildClient({
    lead: leadRow({ status: "pa_action_required", created_by: CALLER_ID, person_responsible_id: "someone-else" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
});

// ── reject_reassign (PR rejecting a lead they didn't create) ──
Deno.test("reject_reassign - rejects a caller who isn't Person Responsible", async () => {
  const client = buildClient({ lead: leadRow({ person_responsible_id: "someone-else" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "reject_reassign" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("reject_reassign - the creator can't use this action (must use drop)", async () => {
  const client = buildClient({ lead: leadRow({ created_by: CALLER_ID, person_responsible_id: CALLER_ID }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "reject_reassign", reassign_to_id: "teammate-1" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("reject_reassign - requires a reassignment target", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "reject_reassign" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Select a team member to assign this lead to.");
});

Deno.test("reject_reassign - can't reassign to yourself", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "reject_reassign", reassign_to_id: CALLER_ID }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("reject_reassign - rejects a target on a different team", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null },
      { data: { id: "teammate-1", role: "project_officer", team: "OtherTeam", is_active: true }, error: null },
    ],
    leads: [{ data: leadRow(), error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "reject_reassign", reassign_to_id: "teammate-1" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("reject_reassign - reassigns to the chosen teammate, status stays pa_review", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null },
      { data: { id: "teammate-1", role: "project_officer", team: TEAM, is_active: true }, error: null },
      { data: [], error: null },
    ],
    leads: [{ data: leadRow(), error: null }, { data: { id: LEAD_ID }, error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "reject_reassign", reassign_to_id: "teammate-1" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_review" });
});

Deno.test("drop - a bystander cannot drop a pa_action_required lead", async () => {
  const client = buildClient({
    lead: leadRow({ status: "pa_action_required", created_by: "someone-else", person_responsible_id: "someone-else-2" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 403);
});

// ── claim ───────────────────────────────────────────────────
Deno.test("claim - rejects a caller whose role isn't PA-tier", async () => {
  const client = buildClient({ caller: callerRow({ role: "cfo" }), lead: leadRow({ status: "pa_dropped" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "claim" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("claim - success reassigns person_responsible_id to the claimant", async () => {
  const client = buildClient({ caller: callerRow({ role: "agm" }), lead: leadRow({ status: "pa_dropped" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "claim" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pa_review");
});

Deno.test("claim - a PA-tier role on a different team is not enough", async () => {
  const client = buildClient({ caller: callerRow({ role: "agm", team: "OtherTeam" }), lead: leadRow({ status: "pa_dropped" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "claim" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("claim - SRM is PA-tier (same permissions as AGM) and can claim a dropped lead", async () => {
  const client = buildClient({ caller: callerRow({ role: "srm" }), lead: leadRow({ status: "pa_dropped" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "claim" }), client as never);
  assertEquals(res.status, 200);
});

// ── PMT review ──────────────────────────────────────────────
Deno.test("pmt_approve - rejects a caller without the PMT committee", async () => {
  const client = buildClient({ caller: callerRow({ committee: null }), lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_approve", comment: "looks good" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("pmt_approve - requires a comment", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT" }), lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_approve" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("pmt_approve - success moves to md_review", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT" }), lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_approve", comment: "looks good" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "md_review");
});

Deno.test("pmt_escalate - requires a comment", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT" }), lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_escalate" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("pmt_escalate - success moves to pmt_extended_review", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT" }), lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_escalate", comment: "needs deeper review" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pmt_extended_review");
});

Deno.test("pmt_decline - success moves to pa_action_required with a reason", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT" }), lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_decline", comment: "missing info" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pa_action_required");
});

Deno.test("pmt_approve - PMT is org-wide, so a member on a *different* team than the lead can still act", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT", team: "OtherTeam" }), lead: leadRow({ status: "pmt_review", team: TEAM }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_approve", comment: "looks good" }), client as never);
  assertEquals(res.status, 200);
});

// ── PMT Extended ────────────────────────────────────────────
Deno.test("pmt_extended_forward_dgm - rejects a caller without the PMT Extended committee", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT" }), lead: leadRow({ status: "pmt_extended_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_extended_forward_dgm" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("pmt_extended_forward_dgm - success moves to dgm_review", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT Extended" }), lead: leadRow({ status: "pmt_extended_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_extended_forward_dgm" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "dgm_review");
});

Deno.test("pmt_extended_approve - requires a comment", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT Extended" }), lead: leadRow({ status: "pmt_extended_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_extended_approve" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("pmt_extended_approve - success moves to md_review", async () => {
  const client = buildClient({ caller: callerRow({ committee: "PMT Extended" }), lead: leadRow({ status: "pmt_extended_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_extended_approve", comment: "looks good" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "md_review");
});

// ── DGM (G3) review — pooled org-wide, not team-scoped ─────
Deno.test("dgm_accept - rejects a non-G3 caller", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm", committee: null }), lead: leadRow({ status: "dgm_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_accept", comment: "reviewed" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("dgm_accept - requires a comment", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm", committee: "G3" }), lead: leadRow({ status: "dgm_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_accept" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("dgm_accept - a G3 member on a *different* team than the lead can still act (org-wide pool)", async () => {
  const client = buildClient({
    caller: callerRow({ role: "dgm", committee: "G3", team: TEAM }),
    lead: leadRow({ status: "dgm_review", team: "SomeOtherTeam" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_accept", comment: "reviewed" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "md_review");
});

Deno.test("dgm_accept - G3 membership grants DGM-equivalent permission even for a non-dgm base role", async () => {
  const client = buildClient({ caller: callerRow({ role: "agm", committee: "G3" }), lead: leadRow({ status: "dgm_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_accept", comment: "reviewed" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("dgm_decline - requires a reason and returns to pa_action_required", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm", committee: "G3" }), lead: leadRow({ status: "dgm_review" }) });
  const missingReason = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_decline" }), client as never);
  assertEquals(missingReason.status, 400);

  const client2 = buildClient({ caller: callerRow({ role: "dgm", committee: "G3" }), lead: leadRow({ status: "dgm_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_decline", comment: "not viable" }), client2 as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pa_action_required");
});

// ── MD review ───────────────────────────────────────────────
Deno.test("md_approve - rejects a non-MD", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm", committee: "G3" }), lead: leadRow({ status: "md_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "md_approve" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("md_approve - success moves to md_approved (terminal)", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), lead: leadRow({ status: "md_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "md_approve" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "md_approved");
});

Deno.test("md_decline - requires a reason and moves to md_declined (terminal)", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), lead: leadRow({ status: "md_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "md_decline", comment: "not aligned" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "md_declined");
});

// ── PIN gate ────────────────────────────────────────────────
Deno.test("PIN gate - accept fails authorization before the PIN is even checked", async () => {
  // Wrong PR *and* no PIN — should fail on authorization (403), not PIN (400).
  const client = buildClient({ lead: leadRow({ person_responsible_id: "someone-else" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept", pin: "" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("PIN gate - accept rejects a missing/malformed PIN once authorized", async () => {
  const client = buildClient({ lead: leadRow({ assigned_ba_id: "existing-ba" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept", pin: "12" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Enter your 4-digit PIN.");
});

Deno.test("PIN gate - accept rejects a caller with no PIN set yet", async () => {
  const client = buildClient({ caller: callerRow({ pin_hash: null }), lead: leadRow({ assigned_ba_id: "existing-ba" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "You haven't set an action PIN yet — set one from My Profile before you can do this.");
});

Deno.test("PIN gate - accept rejects the wrong PIN", async () => {
  const client = buildClient({ lead: leadRow({ assigned_ba_id: "existing-ba" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept", pin: "0000" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Incorrect PIN.");
});

Deno.test("PIN gate - accept succeeds with the correct PIN", async () => {
  const client = buildClient({ lead: leadRow({ assigned_ba_id: "existing-ba" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("PIN gate - dgm_initial_decline (DGM sending it back) does NOT require a PIN", async () => {
  const client = buildClient({ caller: callerRow({ committee: "G3", pin_hash: null }), lead: leadRow({ status: "dgm_initial_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "dgm_initial_decline", comment: "needs more detail", pin: "" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("PIN gate - claim does NOT require a PIN", async () => {
  const client = buildClient({ caller: callerRow({ role: "agm", pin_hash: null }), lead: leadRow({ status: "pa_dropped" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "claim", pin: "" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("PIN gate - drop returned-by-DGM leads with no Withdraw option, even with a valid PIN", async () => {
  const client = buildClient({ lead: leadRow({ status: "pa_action_required", declined_from_status: "dgm_initial_review", created_by: CALLER_ID }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 403);
});

// ── Concurrency ─────────────────────────────────────────────
Deno.test("concurrent action - a second write that matches 0 rows returns a clear conflict error", async () => {
  const client = buildClient({ lead: leadRow({}), updateResult: { data: null, error: null } });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 400);
});
