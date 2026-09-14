import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const PR_ID = "pr-1";
const AA_ID = "aa-1";
const FEE_NOTE_ID = "fee-1";
const CALLER_PIN = "1234";
const PR_PIN_HASH = await hashPin(CALLER_PIN, PR_ID);
const AA_PIN_HASH = await hashPin(CALLER_PIN, AA_ID);

function noteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FEE_NOTE_ID, proposal_id: "prop-1",
    emd_amount: 50000, emd_payment_mode: "online", emd_dd_in_favour_of: null, emd_dd_payable_at: null,
    tender_fee_amount: null, tender_fee_payment_mode: null, tender_fee_dd_in_favour_of: null, tender_fee_dd_payable_at: null,
    processing_fee_amount: null, processing_fee_payment_mode: null, processing_fee_dd_in_favour_of: null, processing_fee_dd_payable_at: null,
    justification: "Required for bid", status: "draft",
    ...overrides,
  };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1", title: "DPR for Smart City", submission_deadline: null,
    person_responsible_id: PR_ID, reviewer_id: "reviewer-1", approval_authority_id: AA_ID,
    ...overrides,
  };
}

function client(opts: {
  caller?: Record<string, unknown>;
  note?: Record<string, unknown> | null;
  proposal?: Record<string, unknown> | null;
  lead?: Record<string, unknown> | null;
  afc_users_extra?: { data: unknown; error: unknown }[];
} = {}) {
  const note = opts.note === undefined ? noteRow() : opts.note;
  return createFakeAdminClient({
    afc_users: [
      opts.caller ? { data: opts.caller, error: null } : { data: { id: PR_ID, role: "project_officer", is_active: true, email: "pr@afc.com", pin_hash: PR_PIN_HASH }, error: null },
      ...(opts.afc_users_extra || []),
    ],
    fee_notes: [{ data: note, error: null }, { data: {}, error: null }],
    proposal_preparations: [{ data: opts.proposal === undefined ? { id: "prop-1", lead_id: "lead-1", locked: false } : opts.proposal, error: null }],
    leads: [{ data: opts.lead === undefined ? leadRow() : opts.lead, error: null }],
  });
}

function req(body: Record<string, unknown>, token = fakeJwt({ sub: PR_ID })) {
  return authedReq("https://x.com/advance-fee-note-stage", { token, body });
}

Deno.test("advance-fee-note-stage - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), client() as never);
  assertEquals(res.status, 200);
});

Deno.test("advance-fee-note-stage - non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), client() as never);
  assertEquals(res.status, 405);
});

Deno.test("advance-fee-note-stage - invalid action is rejected", async () => {
  const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID, action: "bogus" }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("advance-fee-note-stage - aa_send_back requires a remark", async () => {
  const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID, action: "aa_send_back" }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("advance-fee-note-stage - a locked proposal blocks every action", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, action: "pr_forward", pin: CALLER_PIN }),
    client({ proposal: { id: "prop-1", lead_id: "lead-1", locked: true } }) as never,
  );
  assertEquals(res.status, 400);
});

// ── pr_forward ──────────────────────────────────────────────────
Deno.test("pr_forward - a stranger can't forward the note", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, action: "pr_forward", pin: CALLER_PIN }, fakeJwt({ sub: "stranger-1" })),
    client({ caller: { id: "stranger-1", role: "project_officer", is_active: true, email: "x@afc.com", pin_hash: PR_PIN_HASH } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("pr_forward - can't forward a note in the wrong status", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, action: "pr_forward", pin: CALLER_PIN }),
    client({ note: noteRow({ status: "pending_approval_authority" }) }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("pr_forward - an incomplete note (no fee amounts) can't be forwarded", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, action: "pr_forward", pin: CALLER_PIN }),
    client({ note: noteRow({ emd_amount: null }) }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("pr_forward - a DD note missing payee details can't be forwarded", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, action: "pr_forward", pin: CALLER_PIN }),
    client({ note: noteRow({ emd_payment_mode: "demand_draft" }) }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("pr_forward - a note missing a payment mode can't be forwarded", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, action: "pr_forward", pin: CALLER_PIN }),
    client({ note: noteRow({ emd_payment_mode: null }) }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("pr_forward - md has no override — only this lead's own PR/Reviewer can forward", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, action: "pr_forward", pin: CALLER_PIN }, fakeJwt({ sub: "md-1" })),
    client({ caller: { id: "md-1", role: "md", is_active: true, email: "md@afc.com", pin_hash: PR_PIN_HASH } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("pr_forward - wrong PIN is rejected", async () => {
  const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID, action: "pr_forward", pin: "0000" }), client() as never);
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "Incorrect PIN.");
});

Deno.test("pr_forward - happy path moves the note to pending_approval_authority", async () => {
  const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID, action: "pr_forward", pin: CALLER_PIN }), client() as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);
});

// ── aa_forward / aa_send_back ───────────────────────────────────
function aaClient(opts: Parameters<typeof client>[0] = {}) {
  return client({
    caller: { id: AA_ID, role: "dgm", is_active: true, email: "aa@afc.com", pin_hash: AA_PIN_HASH },
    note: noteRow({ status: "pending_approval_authority" }),
    afc_users_extra: [
      { data: [{ id: "md-1" }], error: null },
      { data: [{ email: "md@afc.com" }], error: null },
    ],
    ...opts,
  });
}

function aaReq(body: Record<string, unknown>) {
  return req(body, fakeJwt({ sub: AA_ID }));
}

Deno.test("aa_forward - only the assigned Approval Authority can act", async () => {
  const res = await handleRequest(
    aaReq({ fee_note_id: FEE_NOTE_ID, action: "aa_forward", pin: CALLER_PIN }),
    client({
      caller: { id: "someone-else", role: "dgm", is_active: true, email: "x@afc.com", pin_hash: AA_PIN_HASH },
      note: noteRow({ status: "pending_approval_authority" }),
    }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("aa_forward - md has no override — only this lead's own Approval Authority can act", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, action: "aa_forward", pin: CALLER_PIN }, fakeJwt({ sub: "md-1" })),
    client({
      caller: { id: "md-1", role: "md", is_active: true, email: "md@afc.com", pin_hash: AA_PIN_HASH },
      note: noteRow({ status: "pending_approval_authority" }),
    }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("aa_forward - can't act on a note in the wrong status", async () => {
  const res = await handleRequest(aaReq({ fee_note_id: FEE_NOTE_ID, action: "aa_forward", pin: CALLER_PIN }), aaClient({ note: noteRow({ status: "draft" }) }) as never);
  assertEquals(res.status, 400);
});

Deno.test("aa_forward - happy path moves the note to pending_md", async () => {
  const res = await handleRequest(aaReq({ fee_note_id: FEE_NOTE_ID, action: "aa_forward", pin: CALLER_PIN }), aaClient() as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);
});

Deno.test("aa_send_back - happy path sends the note back to draft, no PIN required", async () => {
  const res = await handleRequest(aaReq({ fee_note_id: FEE_NOTE_ID, action: "aa_send_back", remark: "Amount looks too high" }), aaClient() as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);
});
