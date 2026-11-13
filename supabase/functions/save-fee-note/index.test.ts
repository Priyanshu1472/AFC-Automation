import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "pr-1";
const PROPOSAL_ID = "prop-1";

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1", submission_deadline: null, person_responsible_id: CALLER_ID, reviewer_id: "reviewer-1",
    approval_authority_id: "aa-1", assigned_ba_id: null, ...overrides,
  };
}

// `existing` is the current fee_notes row for this proposal (null = none yet).
function client(opts: {
  caller?: Record<string, unknown>;
  existing?: Record<string, unknown> | null;
  proposal?: Record<string, unknown> | null;
  lead?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
} = {}) {
  return createFakeAdminClient({
    afc_users: [{ data: opts.caller ?? { id: CALLER_ID, role: "project_officer", is_active: true, email: "pr@afc.com" }, error: null }],
    proposal_preparations: [{ data: opts.proposal === undefined ? { id: PROPOSAL_ID, lead_id: "lead-1", locked: false } : opts.proposal, error: null }],
    leads: [{ data: opts.lead === undefined ? leadRow() : opts.lead, error: null }],
    fee_notes: [
      { data: opts.existing === undefined ? null : opts.existing, error: null },
      { data: opts.existing ? {} : { id: "new-fee-1" }, error: opts.updateError ?? null },
    ],
  });
}

function baseFields(overrides: Record<string, unknown> = {}) {
  return { proposal_id: PROPOSAL_ID, justification: "Required for bid participation", emd_amount: 50000, emd_payment_mode: "online", ...overrides };
}

function req(body: Record<string, unknown>, token = fakeJwt({ sub: CALLER_ID })) {
  return authedReq("https://x.com/save-fee-note", { token, body });
}

Deno.test("save-fee-note - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), client() as never);
  assertEquals(res.status, 200);
});

Deno.test("save-fee-note - non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), client() as never);
  assertEquals(res.status, 405);
});

Deno.test("save-fee-note - proposal_id is required", async () => {
  const res = await handleRequest(req({ justification: "x", emd_amount: 100 }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("save-fee-note - at least one fee amount is required", async () => {
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, justification: "x", emd_payment_mode: "online" }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("save-fee-note - justification is required", async () => {
  const res = await handleRequest(req(baseFields({ justification: "  " })), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("save-fee-note - negative amount is rejected", async () => {
  const res = await handleRequest(req(baseFields({ emd_amount: -5 })), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("save-fee-note - an invalid payment mode is rejected", async () => {
  const res = await handleRequest(req(baseFields({ emd_payment_mode: "cash" })), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("save-fee-note - Fixed Deposit Receipt is a valid payment mode", async () => {
  const res = await handleRequest(req(baseFields({ emd_payment_mode: "fixed_deposit_receipt" })), client() as never);
  assertEquals(res.status, 200);
});

Deno.test("save-fee-note - a note that isn't draft can't be edited", async () => {
  const res = await handleRequest(req(baseFields()), client({ existing: { id: "fee-1", status: "pending_md" } }) as never);
  assertEquals(res.status, 400);
});

Deno.test("save-fee-note - only Person Responsible/Reviewer/md/admin can edit", async () => {
  const res = await handleRequest(
    req(baseFields(), fakeJwt({ sub: "stranger-1" })),
    client({ caller: { id: "stranger-1", role: "project_officer", is_active: true, email: "x@afc.com" } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("save-fee-note - a locked proposal can't be edited", async () => {
  const res = await handleRequest(req(baseFields()), client({ proposal: { id: PROPOSAL_ID, lead_id: "lead-1", locked: true } }) as never);
  assertEquals(res.status, 400);
});

Deno.test("save-fee-note - a BP-borne fee is rejected when the lead has no Business Partner", async () => {
  const res = await handleRequest(req(baseFields({ emd_borne_by: "bp" })), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("save-fee-note - a BP-borne fee is allowed when the lead has an assigned Business Partner (regardless of source)", async () => {
  const res = await handleRequest(
    req(baseFields({ emd_borne_by: "bp" })),
    client({ lead: leadRow({ assigned_ba_id: "ba-1" }) }) as never,
  );
  assertEquals(res.status, 200);
});

Deno.test("save-fee-note - happy path creates the note and returns its id", async () => {
  const res = await handleRequest(req(baseFields({ processing_fee_amount: 5000 })), client() as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);
  assertEquals(json.fee_note_id, "new-fee-1");
});

Deno.test("save-fee-note - happy path updates an existing draft note", async () => {
  const res = await handleRequest(req(baseFields()), client({ existing: { id: "fee-1", status: "draft" } }) as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);
  assertEquals(json.fee_note_id, "fee-1");
});
