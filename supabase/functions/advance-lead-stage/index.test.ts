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
    recommending_authority_id: "authority-1", handled_by_dgm_id: null,
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
  assertEquals((await res.json()).error, "Generate the Lead Approval Note before submitting for approval.");
});

Deno.test("accept - success moves to recommending_authority_review when the lead already has a BP", async () => {
  const client = buildClient({ lead: leadRow({ assigned_ba_id: "existing-ba" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "recommending_authority_review" });
});

Deno.test("accept - notifies only this lead's named Recommending Authority", async () => {
  const client = buildClient({ lead: leadRow({ assigned_ba_id: "existing-ba" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 200);

  const notifyLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "notifications");
  const rows = JSON.parse(notifyLog[0].calls.find((c) => c[0] === "insert")![1]);
  assertEquals(rows.map((r: { user_id: string }) => r.user_id), ["authority-1"]);
});

// A Business Partner is optional at submission, same as at creation — the
// note prints "Yet to be Decided" and one can be picked later.
Deno.test("accept - a BP is optional; with none picked the lead still moves on and none is set", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "recommending_authority_review");

  const leadsLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
  const updatedFields = JSON.parse(leadsLog[1].calls.find((c) => c[0] === "update")![1]);
  assertEquals("assigned_ba_id" in updatedFields, false);
});

// A BP from another team is now allowed (leads can use any empanelled BP
// org-wide) — but an inactive / non-BP account is still rejected.
Deno.test("accept - rejects an inactive BP", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null },
      { data: { id: "ba-9", role: "business_associate", team: "OtherTeam", is_active: false }, error: null },
    ],
    leads: [{ data: leadRow(), error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept", assigned_ba_id: "ba-9" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("accept - accepts and assigns a BP when caller selects one", async () => {
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
  assertEquals(await res.json(), { success: true, status: "recommending_authority_review" });
});

// ── Recommending Authority review — the lead's named Recommending
// Authority alone acts (no role/committee override), with a required
// comment; approve is PIN-gated, decline isn't ──
function raLead(overrides: Record<string, unknown> = {}) {
  return leadRow({
    status: "recommending_authority_review", person_responsible_id: "pr-1",
    recommending_authority_id: CALLER_ID, assigned_ba_id: "existing-ba", ...overrides,
  });
}

function leadUpdate(client: unknown) {
  const leadsLog = (client as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
  return JSON.parse(leadsLog[1].calls.find((c) => c[0] === "update")![1]);
}

Deno.test("ra_approve - rejects anyone but the lead's named Recommending Authority, even the MD", async () => {
  for (const caller of [callerRow(), callerRow({ role: "md" }), callerRow({ role: "dgm", committee: "PMT" })]) {
    const client = buildClient({ caller, lead: raLead({ recommending_authority_id: "authority-1" }) });
    const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve", comment: "ok" }), client as never);
    assertEquals(res.status, 403, `expected 403 for role=${caller.role}`);
  }
});

Deno.test("ra_approve - requires a comment", async () => {
  const client = buildClient({ lead: raLead() });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Comment/Description is required");
});

Deno.test("ra_approve - a first-ever submission moves to pmt_review", async () => {
  const client = buildClient({ lead: raLead() });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve", comment: "recommended" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pmt_review");
});

Deno.test("ra_approve - a lead declined by the Recommending Authority or PMT resubmits to pmt_review, nothing to skip", async () => {
  for (const declinedFrom of ["recommending_authority_review", "pmt_review"]) {
    const client = buildClient({ lead: raLead({ declined_from_status: declinedFrom }) });
    const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve", comment: "fixed" }), client as never);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).status, "pmt_review", `declined_from_status=${declinedFrom}`);
  }
});

Deno.test("ra_approve - a lead declined by MD resumes directly at md_review, skipping PMT", async () => {
  const client = buildClient({ lead: raLead({ declined_from_status: "md_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve", comment: "addressed MD remarks" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "md_review");
});

Deno.test("ra_approve - consumes declined_from_status and records who handled it", async () => {
  const client = buildClient({ lead: raLead({ declined_from_status: "md_review" }) });
  await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve", comment: "ok" }), client as never);
  const fields = leadUpdate(client);
  assertEquals(fields.declined_from_status, null);
  assertEquals(fields.handled_by_dgm_id, CALLER_ID);
});

Deno.test("ra_approve - bulk-adds the named trio plus every PMT holder to the chat roster", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null },
      { data: [{ id: "pmt-1" }, { id: "pmt-2" }], error: null }, // getOrgWideHolders(committee: PMT)
    ],
    leads: [{ data: raLead(), error: null }, { data: { id: LEAD_ID }, error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve", comment: "ok" }), client as never);
  assertEquals(res.status, 200);
  const participantCalls = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "lead_chat_participants");
  const rows = participantCalls.flatMap((l) => JSON.parse(l.calls.find((c) => c[0] === "upsert")![1]));
  assertEquals(
    rows.map((r: { user_id: string; role_at_add: string }) => `${r.user_id}:${r.role_at_add}`).sort(),
    ["caller-1:named", "pmt-1:PMT", "pmt-2:PMT", "pr-1:named", "reviewer-1:named"],
  );
});

Deno.test("ra_approve - opens the chat if it never opened, but never overwrites an existing chat_opened_at", async () => {
  const fresh = buildClient({ lead: raLead({ chat_opened_at: null }) });
  await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve", comment: "ok" }), fresh as never);
  assertEquals(typeof leadUpdate(fresh).chat_opened_at, "string");

  const opened = buildClient({ lead: raLead({ chat_opened_at: "2026-01-01T00:00:00Z" }) });
  await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve", comment: "ok" }), opened as never);
  assertEquals("chat_opened_at" in leadUpdate(opened), false);
});

Deno.test("PIN gate - ra_approve requires a PIN", async () => {
  const client = buildClient({ caller: callerRow({ pin_hash: null }), lead: raLead() });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_approve", comment: "ok", pin: "" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Enter your 4-digit PIN.");
});

Deno.test("ra_decline - rejects anyone but the lead's named Recommending Authority", async () => {
  const client = buildClient({ lead: raLead({ recommending_authority_id: "authority-1" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_decline", comment: "no" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("ra_decline - requires a reason and returns to pa_action_required, remembering who declined", async () => {
  const noReason = buildClient({ lead: raLead() });
  const missing = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_decline" }), noReason as never);
  assertEquals(missing.status, 400);

  const client = buildClient({ lead: raLead() });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_decline", comment: "needs rework" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pa_action_required");
  assertEquals(leadUpdate(client).declined_from_status, "recommending_authority_review");
});

Deno.test("ra_decline - strips the stale approval_note document off the lead", async () => {
  const staleDoc = { name: "note.pdf", path: "lead-1/note.pdf", size: 1, uploaded_at: "x", category: "approval_note" };
  const otherDoc = { name: "rfp.pdf", path: "lead-1/rfp.pdf", size: 1, uploaded_at: "x" };
  const client = buildClient({ lead: raLead({ documents: [staleDoc, otherDoc] }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_decline", comment: "not viable" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(leadUpdate(client).documents, [otherDoc]);
});

Deno.test("ra_decline - adds nobody to the chat roster (a decline never grows it)", async () => {
  const client = buildClient({ lead: raLead() });
  await handleRequest(req({ lead_id: LEAD_ID, action: "ra_decline", comment: "no" }), client as never);
  const participantCalls = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "lead_chat_participants");
  assertEquals(participantCalls.length, 0);
});

Deno.test("PIN gate - ra_decline (sending it back) does NOT require a PIN", async () => {
  const client = buildClient({ caller: callerRow({ pin_hash: null }), lead: raLead() });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "ra_decline", comment: "rework", pin: "" }), client as never);
  assertEquals(res.status, 200);
});


// Resubmission after a decline reuses "accept" — the exact same
// action/PIN gate as the very first submission — for a decline from *any*
// stage (Recommending Authority, PMT, or MD), always routing back through
// the Recommending Authority again (see ra_approve for the MD skip-ahead).
Deno.test("accept (resubmit) - valid regardless of which stage declined it", async () => {
  for (const declinedFrom of ["recommending_authority_review", "pmt_review", "md_review"]) {
    const client = buildClient({
      lead: leadRow({ status: "pa_action_required", declined_from_status: declinedFrom, assigned_ba_id: "existing-ba" }),
    });
    const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
    assertEquals(res.status, 200, `expected 200 for declined_from_status=${declinedFrom}`);
    assertEquals((await res.json()).status, "recommending_authority_review");
  }
});

Deno.test("accept (resubmit) - only the Person Responsible can resubmit", async () => {
  const client = buildClient({
    lead: leadRow({
      status: "pa_action_required", declined_from_status: "recommending_authority_review",
      person_responsible_id: "someone-else", assigned_ba_id: "existing-ba",
    }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("accept (resubmit) - requires the Lead Approval Note to already be regenerated", async () => {
  const client = buildClient({
    lead: leadRow({
      status: "pa_action_required", declined_from_status: "recommending_authority_review",
      approval_note_data: null, assigned_ba_id: "existing-ba",
    }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("accept (resubmit) - success sends the lead straight back to recommending_authority_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "pa_action_required", declined_from_status: "recommending_authority_review", assigned_ba_id: "existing-ba" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "recommending_authority_review");
});

Deno.test("PIN gate - accept (resubmit after a Recommending Authority decline) still requires a PIN, same as the first submission", async () => {
  const client = buildClient({
    caller: callerRow({ pin_hash: null }),
    lead: leadRow({ status: "pa_action_required", declined_from_status: "recommending_authority_review", assigned_ba_id: "existing-ba" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept", pin: "" }), client as never);
  assertEquals(res.status, 400);
});

// ── submit_for_pr_review / pr_review_accept / pr_review_reject ──
// The creator (not the PR) filling the note routes it to the PR for
// Accept/Edit/Reject before it can be submitted for approval — the PR's
// signature must never be auto-stamped on a note they haven't reviewed
// (see approval_note_pr_reviewed / leadApprovalPdf.ts). All three are
// same-status transitions — the lead never leaves pa_review/
// pa_action_required, only the approval_note_pending_pr_review /
// approval_note_pr_reviewed flags move.
Deno.test("submit_for_pr_review - rejects the Person Responsible themselves (they'd Accept directly instead)", async () => {
  const client = buildClient({ lead: leadRow({ created_by: CALLER_ID, person_responsible_id: CALLER_ID }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "submit_for_pr_review" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("submit_for_pr_review - rejects a caller who isn't the lead's creator", async () => {
  const client = buildClient({ lead: leadRow({ created_by: "someone-else", person_responsible_id: "pr-1" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "submit_for_pr_review" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("submit_for_pr_review - requires the Lead Approval Note to already be generated", async () => {
  const client = buildClient({ lead: leadRow({ created_by: CALLER_ID, person_responsible_id: "pr-1", approval_note_data: null }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "submit_for_pr_review" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("submit_for_pr_review - rejects sending it for review twice in a row", async () => {
  const client = buildClient({
    lead: leadRow({ created_by: CALLER_ID, person_responsible_id: "pr-1", approval_note_pending_pr_review: true }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "submit_for_pr_review" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("submit_for_pr_review - not valid from any status other than pa_review/pa_action_required", async () => {
  const client = buildClient({ lead: leadRow({ status: "recommending_authority_review", created_by: CALLER_ID, person_responsible_id: "pr-1" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "submit_for_pr_review" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("submit_for_pr_review - success leaves the status untouched and sets approval_note_pending_pr_review", async () => {
  for (const status of ["pa_review", "pa_action_required"]) {
    const client = buildClient({ lead: leadRow({ status, created_by: CALLER_ID, person_responsible_id: "pr-1" }) });
    const res = await handleRequest(req({ lead_id: LEAD_ID, action: "submit_for_pr_review" }), client as never);
    assertEquals(res.status, 200, `expected 200 from status=${status}`);
    assertEquals((await res.json()).status, status, `expected status to stay ${status}`);

    const leadsLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
    const updatedFields = JSON.parse(leadsLog[1].calls.find((c) => c[0] === "update")![1]);
    assertEquals(updatedFields.approval_note_pending_pr_review, true);
  }
});

Deno.test("submit_for_pr_review - notifies the Person Responsible", async () => {
  const client = buildClient({ lead: leadRow({ created_by: CALLER_ID, person_responsible_id: "pr-1" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "submit_for_pr_review" }), client as never);
  assertEquals(res.status, 200);

  const notifyLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "notifications");
  assertEquals(notifyLog.length, 1);
  const rows = JSON.parse(notifyLog[0].calls.find((c) => c[0] === "insert")![1]);
  assertEquals(rows.map((r: { user_id: string }) => r.user_id), ["pr-1"]);
});

Deno.test("pr_review_accept - rejects a caller who isn't the Person Responsible", async () => {
  const client = buildClient({ lead: leadRow({ person_responsible_id: "someone-else", approval_note_pending_pr_review: true }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pr_review_accept" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("pr_review_accept - rejects when nothing is actually pending review", async () => {
  const client = buildClient({ lead: leadRow({ approval_note_pending_pr_review: false }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pr_review_accept" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("pr_review_accept - success leaves the status untouched, clears pending, and marks the note PR-reviewed", async () => {
  const client = buildClient({ lead: leadRow({ approval_note_pending_pr_review: true }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pr_review_accept" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pa_review");

  const leadsLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
  const updatedFields = JSON.parse(leadsLog[1].calls.find((c) => c[0] === "update")![1]);
  assertEquals(updatedFields.approval_note_pr_reviewed, true);
  assertEquals(updatedFields.approval_note_pending_pr_review, false);
});

Deno.test("pr_review_accept - does not require a PIN", async () => {
  const client = buildClient({ caller: callerRow({ pin_hash: null }), lead: leadRow({ approval_note_pending_pr_review: true }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pr_review_accept", pin: "" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("pr_review_reject - rejects a caller who isn't the Person Responsible", async () => {
  const client = buildClient({ lead: leadRow({ person_responsible_id: "someone-else", approval_note_pending_pr_review: true }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pr_review_reject", comment: "needs more detail" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("pr_review_reject - rejects when nothing is actually pending review", async () => {
  const client = buildClient({ lead: leadRow({ approval_note_pending_pr_review: false }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pr_review_reject", comment: "needs more detail" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("pr_review_reject - requires a comment, and leaves the status untouched while clearing the pending flag", async () => {
  const client = buildClient({ lead: leadRow({ approval_note_pending_pr_review: true }) });
  const missingReason = await handleRequest(req({ lead_id: LEAD_ID, action: "pr_review_reject" }), client as never);
  assertEquals(missingReason.status, 400);

  const client2 = buildClient({ lead: leadRow({ approval_note_pending_pr_review: true }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pr_review_reject", comment: "needs more detail" }), client2 as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pa_review");

  const leadsLog = (client2 as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
  const updatedFields = JSON.parse(leadsLog[1].calls.find((c) => c[0] === "update")![1]);
  assertEquals(updatedFields.approval_note_pending_pr_review, false);
  assertEquals("declined_from_status" in updatedFields, false);
});

Deno.test("pr_review_reject - notifies the creator", async () => {
  const client = buildClient({ lead: leadRow({ created_by: "creator-1", approval_note_pending_pr_review: true }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pr_review_reject", comment: "needs more detail" }), client as never);
  assertEquals(res.status, 200);

  const notifyLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "notifications");
  const rows = JSON.parse(notifyLog[0].calls.find((c) => c[0] === "insert")![1]);
  assertEquals(rows.map((r: { user_id: string }) => r.user_id), ["creator-1"]);
});

Deno.test("accept - a Person Responsible submitting directly (even one that skipped the explicit Accept step) always marks the note PR-reviewed", async () => {
  const client = buildClient({ lead: leadRow({ assigned_ba_id: "existing-ba", approval_note_pending_pr_review: true }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 200);

  const leadsLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
  const updatedFields = JSON.parse(leadsLog[1].calls.find((c) => c[0] === "update")![1]);
  assertEquals(updatedFields.approval_note_pr_reviewed, true);
  assertEquals(updatedFields.approval_note_pending_pr_review, false);
});

Deno.test("accept - regenerating the note on submission drops the '-- Draft' suffix, replacing (not duplicating) the stored document", async () => {
  const originalFetch = globalThis.fetch;
  const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  globalThis.fetch = (() =>
    Promise.resolve(new Response(Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0)), { status: 200 }))) as unknown as typeof fetch;

  try {
    const staleDraft = { name: "Lead Approval Note -- Draft.pdf", path: `${LEAD_ID}/draft.pdf`, size: 5, uploaded_at: "2026-08-01T00:00:00Z", category: "approval_note" };
    const client = createFakeAdminClient({
      afc_users: [
        { data: callerRow(), error: null }, // getCallerProfile (PR)
        { data: [], error: null }, // getOrgWideHolders notify fan-out
        { data: { full_name: "Priya Sharma", role: "project_officer", signature_path: null }, error: null }, // regenerateApprovalNote's PR lookup
      ],
      leads: [
        { data: leadRow({ assigned_ba_id: "existing-ba", documents: [staleDraft] }), error: null }, // initial fetch
        { data: { id: LEAD_ID }, error: null }, // guarded status update
        { // regenerateApprovalNote's own fresh fetch — status already flipped to recommending_authority_review
          data: {
            id: LEAD_ID, lead_number: "LH-2026-000001", title: "Test Lead", status: "recommending_authority_review",
            client_name: null, submission_deadline: null, assigned_ba_id: "existing-ba", person_responsible_id: CALLER_ID,
            team: TEAM, documents: [staleDraft], approval_note_data: { nature_of_lead: "Nomination" },
          },
          error: null,
        },
        { data: {}, error: null }, // documents write-back
      ],
      lead_activity_log: [{ data: [], error: null }],
    });

    const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
    assertEquals(res.status, 200);

    const leadsLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
    const documentsUpdateCall = leadsLog[3].calls.find((c) => c[0] === "update");
    const updatedFields = JSON.parse(documentsUpdateCall![1]);
    assertEquals(updatedFields.documents.length, 1);
    assertEquals(updatedFields.documents[0].name, "Lead Approval Note.pdf");
    assertEquals(updatedFields.documents[0].category, "approval_note");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// "drop" (true, no-reassignment withdrawal) is available only to the
// named PR, Reviewer, or Recommending Authority at pa_review — never the
// creator alone.
Deno.test("drop - the creator alone (not PR/Reviewer/RA) can't drop at pa_review", async () => {
  const client = buildClient({
    lead: leadRow({ created_by: CALLER_ID, person_responsible_id: "someone-else", reviewer_id: "someone-else", recommending_authority_id: "someone-else" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("drop - the assigned Person Responsible can drop at pa_review, whether or not they're also the creator", async () => {
  const client = buildClient({ lead: leadRow({ created_by: CALLER_ID, person_responsible_id: CALLER_ID, recommending_authority_id: "authority-1" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_dropped" });
});

Deno.test("drop - the Reviewer (not PR, not creator) can drop at pa_review", async () => {
  const client = buildClient({
    lead: leadRow({ created_by: "creator-1", person_responsible_id: "someone-else", reviewer_id: CALLER_ID, recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_dropped" });
});

Deno.test("drop - the Recommending Authority (not PR, not Reviewer, not creator) can drop at pa_review", async () => {
  const client = buildClient({
    lead: leadRow({ created_by: "creator-1", person_responsible_id: "someone-else", reviewer_id: "someone-else", recommending_authority_id: CALLER_ID }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_dropped" });
});

// At recommending_authority_review, only the Recommending Authority or the
// Person Responsible can drop — the Reviewer no longer can.
Deno.test("drop - the Person Responsible can drop at recommending_authority_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "recommending_authority_review", created_by: "someone-else", person_responsible_id: CALLER_ID, recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_dropped" });
});

Deno.test("drop - the Recommending Authority can drop at recommending_authority_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "recommending_authority_review", created_by: "creator-1", person_responsible_id: "someone-else", recommending_authority_id: CALLER_ID }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("drop - the Reviewer can no longer drop at recommending_authority_review", async () => {
  const client = buildClient({
    lead: leadRow({
      status: "recommending_authority_review", created_by: "creator-1", person_responsible_id: "someone-else",
      reviewer_id: CALLER_ID, recommending_authority_id: "authority-1",
    }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 403);
});

// Drop is removed entirely once a lead reaches PMT review — no role, not
// even MD or PMT, can drop it here or at md_review/md_approved anymore.
Deno.test("drop - is no longer a valid action at pmt_review, for anyone", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    lead: leadRow({ status: "pmt_review", created_by: "someone-else", person_responsible_id: "someone-else-2", recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("drop - is no longer a valid action at md_review, for anyone", async () => {
  const client = buildClient({
    caller: callerRow({ committee: "PMT" }),
    lead: leadRow({ status: "md_review", created_by: "someone-else", person_responsible_id: "someone-else-2", recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("drop - is no longer a valid action once MD has approved the lead", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    lead: leadRow({ status: "md_approved", created_by: "creator-1", person_responsible_id: "someone-else", recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop", comment: "Client cancelled the tender." }), client as never);
  assertEquals(res.status, 400);
});

// withdraw_submission (returns to pa_review, not a drop) only exists at
// recommending_authority_review — once a lead has passed that stage it can
// no longer be withdrawn, only dropped (and, past PMT review, not even
// that — see above).
Deno.test("withdraw_submission - the Person Responsible can withdraw at recommending_authority_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "recommending_authority_review", created_by: "someone-else", person_responsible_id: CALLER_ID, recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "withdraw_submission", comment: "Need to fix the Business Partner." }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "pa_review" });
});

Deno.test("withdraw_submission - is no longer a valid action once the lead reaches pmt_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "pmt_review", created_by: "someone-else", person_responsible_id: CALLER_ID, recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "withdraw_submission", comment: "Need to fix the Business Partner." }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("withdraw_submission - is no longer a valid action once the lead reaches md_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "md_review", created_by: "someone-else", person_responsible_id: CALLER_ID, recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "withdraw_submission", comment: "Need to fix the Business Partner." }), client as never);
  assertEquals(res.status, 400);
});

// At pa_action_required, Drop reappears only as an escape hatch for the
// Person Responsible when PMT or MD sent the lead back — a lead the
// Recommending Authority sent back has no Drop at all (see the earlier
// "returned by the Recommending Authority" test elsewhere in this file).
Deno.test("drop - the Person Responsible can drop a pa_action_required lead declined from pmt_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "pa_action_required", declined_from_status: "pmt_review", created_by: "someone-else", person_responsible_id: CALLER_ID, recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("drop - the Person Responsible can drop a pa_action_required lead declined from md_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "pa_action_required", declined_from_status: "md_review", created_by: "someone-else", person_responsible_id: CALLER_ID, recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("drop - MD/PMT do NOT gain Drop at pa_action_required just from being MD/PMT — only the named Person Responsible can", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    lead: leadRow({ status: "pa_action_required", declined_from_status: "pmt_review", created_by: "someone-else", person_responsible_id: "someone-else-2", recommending_authority_id: "authority-1" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("drop - the Recommending Authority (not the Person Responsible) cannot drop a pa_action_required lead declined from pmt_review", async () => {
  const client = buildClient({
    lead: leadRow({ status: "pa_action_required", declined_from_status: "pmt_review", created_by: "someone-else", person_responsible_id: "someone-else-2", recommending_authority_id: CALLER_ID }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 403);
});

// ── reject_reassign (PR handing a lead to a teammate instead of dropping) ──
Deno.test("reject_reassign - rejects a caller who isn't Person Responsible", async () => {
  const client = buildClient({ lead: leadRow({ person_responsible_id: "someone-else" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "reject_reassign" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("reject_reassign - a self-assigned PR (also the creator) can still use this action", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null },
      { data: { id: "teammate-1", role: "project_officer", team: TEAM, is_active: true }, error: null },
      { data: [], error: null },
    ],
    leads: [
      { data: leadRow({ created_by: CALLER_ID, person_responsible_id: CALLER_ID }), error: null },
      { data: { id: LEAD_ID }, error: null },
    ],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "reject_reassign", reassign_to_id: "teammate-1" }), client as never);
  assertEquals(res.status, 200);
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

Deno.test("pmt_approve - bulk-adds every MD holder to the chat roster", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow({ committee: "PMT" }), error: null },
      { data: [{ id: "md-1" }], error: null }, // getOrgWideHolders(role: md)
    ],
    leads: [{ data: leadRow({ status: "pmt_review" }), error: null }, { data: { id: LEAD_ID }, error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "pmt_approve", comment: "looks good" }), client as never);
  assertEquals(res.status, 200);
  const participantCalls = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "lead_chat_participants");
  assertEquals(participantCalls.length, 1);
  const rows = JSON.parse(participantCalls[0].calls.find((c) => c[0] === "upsert")![1]);
  assertEquals(rows, [{ lead_id: LEAD_ID, user_id: "md-1", role_at_add: "md" }]);
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

// ── MD review ───────────────────────────────────────────────
Deno.test("md_approve - rejects a non-MD", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm" }), lead: leadRow({ status: "md_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "md_approve" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("md_approve - success moves to md_approved (terminal)", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), lead: leadRow({ status: "md_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "md_approve" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "md_approved");
});

Deno.test("md_decline - requires a reason and returns the lead to pa_action_required (not terminal)", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), lead: leadRow({ status: "md_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "md_decline", comment: "not aligned" }), client as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "pa_action_required");
});

Deno.test("md_decline - notifies creator, PR, and whichever committee last sent it to MD", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow({ role: "md" }), error: null }, // getCallerProfile
      { data: [{ id: "pmt-member-1" }, { id: "pmt-member-2" }], error: null }, // getOrgWideHolders(PMT)
    ],
    leads: [
      { data: leadRow({ status: "md_review", created_by: "creator-1", person_responsible_id: "pr-1" }), error: null },
      { data: { id: LEAD_ID }, error: null },
    ],
    lead_activity_log: [
      { data: { action: "pmt_approve", created_at: "2026-01-01T00:00:00Z" }, error: null }, // resolveCommitteeThatSentToMd
      { data: null, error: null }, // logLeadActivity insert (result unused)
    ],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "md_decline", comment: "not aligned" }), client as never);
  assertEquals(res.status, 200);
  const notifyCall = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.find((l) => l.table === "notifications");
  assertEquals(notifyCall !== undefined, true);
});

Deno.test("md_decline - a lead with no resolvable sending committee still returns to the creator/PR only", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), lead: leadRow({ status: "md_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "md_decline", comment: "not aligned" }), client as never);
  assertEquals(res.status, 200);
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

Deno.test("PIN gate - claim does NOT require a PIN", async () => {
  const client = buildClient({ caller: callerRow({ role: "agm", pin_hash: null }), lead: leadRow({ status: "pa_dropped" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "claim", pin: "" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("PIN gate - a lead returned by the Recommending Authority can't be dropped, even with a valid PIN", async () => {
  const client = buildClient({ lead: leadRow({ status: "pa_action_required", declined_from_status: "recommending_authority_review", created_by: CALLER_ID }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "drop" }), client as never);
  assertEquals(res.status, 403);
});

// ── Concurrency ─────────────────────────────────────────────
Deno.test("concurrent action - a second write that matches 0 rows returns a clear conflict error", async () => {
  const client = buildClient({ lead: leadRow({}), updateResult: { data: null, error: null } });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 400);
});

// ── Submission Overdue ──────────────────────────────────────
Deno.test("overdue - accept is blocked once the submission deadline has passed", async () => {
  const client = buildClient({ lead: leadRow({ submission_deadline: "2000-01-01" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.includes("submission deadline has passed"), true);
});

Deno.test("overdue - a future submission deadline is not overdue, action proceeds normally", async () => {
  const client = buildClient({ lead: leadRow({ submission_deadline: "2099-01-01", assigned_ba_id: "existing-ba" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "accept" }), client as never);
  assertEquals(res.status, 200);
});

// md_approved allows no further action at all, so pa_dropped (the other
// terminal status, still claimable) is what proves the overdue block skips
// finished leads.
Deno.test("overdue - a terminal lead (pa_dropped) is never treated as overdue", async () => {
  const client = buildClient({
    caller: callerRow({ role: "agm" }),
    lead: leadRow({ status: "pa_dropped", submission_deadline: "2000-01-01" }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, action: "claim" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("overdue - po_assign on an overdue po_assignment lead is blocked too (no PR yet, creator must fix the date via update-lead)", async () => {
  const client = buildClient({
    caller: callerRow({ role: "project_officer" }),
    lead: leadRow({ status: "po_assignment", person_responsible_id: null, forwarded_to_id: CALLER_ID, submission_deadline: "2000-01-01" }),
  });
  const res = await handleRequest(
    req({ lead_id: LEAD_ID, action: "po_assign", person_responsible_id: "pr-1", reviewer_id: "reviewer-1", recommending_authority_id: "authority-1" }),
    client as never
  );
  assertEquals(res.status, 403);
});
