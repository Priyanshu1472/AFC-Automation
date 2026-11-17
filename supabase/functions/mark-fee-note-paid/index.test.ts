import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

const ACC_ID = "acc-1";
const PIN = "1234";
const PIN_HASH = await hashPin(PIN, ACC_ID);
const caller = { id: ACC_ID, role: "project_officer", is_active: true, email: "acc@afc.com", pin_hash: PIN_HASH };

function client(opts: { member?: boolean; note?: Record<string, unknown>; updated?: unknown[] } = {}) {
  return createFakeAdminClient({
    afc_users: [
      { data: caller, error: null },
      { data: { is_active: true }, error: null },
    ],
    afc_user_committees: [
      { data: [], error: null }, // caller's own committees (getCallerProfile) — irrelevant here
      { data: (opts.member ?? true) ? { user_id: ACC_ID } : null, error: null }, // isAccountsMember's membership check
    ],
    fee_notes: [
      { data: opts.note ?? { id: "fee-1", proposal_id: "prop-1", status: "approved", payment_status: "pending" }, error: null },
      { data: opts.updated ?? [{ id: "fee-1" }], error: null },
    ],
    proposal_preparations: [{ data: { id: "prop-1", lead_id: "lead-1", locked: true, client_response: "pending" }, error: null }],
    leads: [{ data: { id: "lead-1", lead_number: "AFC/TEAM 1/L/26/001", title: "DPR", person_responsible_id: "pr-1", reviewer_id: "rev-1", recommending_authority_id: "ra-1" }, error: null }],
  });
}

const req = (body: Record<string, unknown>) => authedReq("https://x.com/mark-fee-note-paid", { token: fakeJwt({ sub: ACC_ID }), body });

Deno.test("mark-fee-note-paid - only an Accounts Committee member", async () => {
  const res = await handleRequest(req({ fee_note_id: "fee-1", pin: PIN }), client({ member: false }) as never);
  assertEquals(res.status, 403);
});

Deno.test("mark-fee-note-paid - note must be MD-approved", async () => {
  const res = await handleRequest(
    req({ fee_note_id: "fee-1", pin: PIN }),
    client({ note: { id: "fee-1", proposal_id: "prop-1", status: "pending_md", payment_status: "pending" } }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("mark-fee-note-paid - can't be paid twice", async () => {
  const res = await handleRequest(
    req({ fee_note_id: "fee-1", pin: PIN }),
    client({ note: { id: "fee-1", proposal_id: "prop-1", status: "approved", payment_status: "paid" } }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("mark-fee-note-paid - wrong PIN is rejected", async () => {
  const res = await handleRequest(req({ fee_note_id: "fee-1", pin: "9999" }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("mark-fee-note-paid - records the payment", async () => {
  const fake = client();
  const res = await handleRequest(req({ fee_note_id: "fee-1", pin: PIN, payment_reference: "UTR123", remark: "Paid via NEFT" }), fake as never);
  assertEquals(res.status, 200);
  const update = fake.__log.filter((l) => l.table === "fee_notes").flatMap((l) => l.calls).find((c) => c[0] === "update");
  assertMatch(update![1], /"payment_status":"paid"/);
  assertMatch(update![1], /"payment_done_by":"acc-1"/);
  assertMatch(update![1], /"payment_reference":"UTR123"/);
});

Deno.test("mark-fee-note-paid - a concurrent payment returns 409", async () => {
  const res = await handleRequest(req({ fee_note_id: "fee-1", pin: PIN }), client({ updated: [] }) as never);
  assertEquals(res.status, 409);
});
