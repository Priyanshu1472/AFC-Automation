import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

const MD_ID = "md-1";
const FEE_NOTE_ID = "fee-1";
const CALLER_PIN = "1234";
const MD_PIN_HASH = await hashPin(CALLER_PIN, MD_ID);

function noteRow(overrides: Record<string, unknown> = {}) {
  return { id: FEE_NOTE_ID, proposal_id: "prop-1", status: "pending_md", ...overrides };
}

function client(opts: {
  caller?: Record<string, unknown>;
  note?: Record<string, unknown> | null;
} = {}) {
  const note = opts.note === undefined ? noteRow() : opts.note;
  return createFakeAdminClient({
    afc_users: [{ data: opts.caller ?? { id: MD_ID, role: "md", is_active: true, email: "md@afc.com", pin_hash: MD_PIN_HASH }, error: null }],
    fee_notes: [{ data: note, error: null }, { data: {}, error: null }],
    proposal_preparations: [{ data: { lead_id: "lead-1" }, error: null }],
    leads: [{ data: { title: "DPR for Smart City", person_responsible_id: "pr-1", reviewer_id: "reviewer-1", approval_authority_id: "aa-1" }, error: null }],
  });
}

function req(body: Record<string, unknown>, token = fakeJwt({ sub: MD_ID })) {
  return authedReq("https://x.com/decide-fee-note-md", { token, body });
}

Deno.test("decide-fee-note-md - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), client() as never);
  assertEquals(res.status, 200);
});

Deno.test("decide-fee-note-md - non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), client() as never);
  assertEquals(res.status, 405);
});

Deno.test("decide-fee-note-md - only md can decide", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, decision: "approved", pin: CALLER_PIN }),
    client({ caller: { id: "pr-1", role: "project_officer", is_active: true, email: "pr@afc.com", pin_hash: MD_PIN_HASH } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("decide-fee-note-md - admin has no override here (would print as the wrong signature)", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, decision: "approved", pin: CALLER_PIN }),
    client({ caller: { id: "admin-1", role: "admin", is_active: true, email: "admin@afc.com", pin_hash: MD_PIN_HASH } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("decide-fee-note-md - invalid decision is rejected", async () => {
  const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID, decision: "maybe", pin: CALLER_PIN }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("decide-fee-note-md - a rejection requires a remark", async () => {
  const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID, decision: "rejected", pin: CALLER_PIN }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("decide-fee-note-md - wrong PIN is rejected", async () => {
  const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID, decision: "approved", pin: "0000" }), client() as never);
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "Incorrect PIN.");
});

Deno.test("decide-fee-note-md - a note not pending_md can't be decided", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID, decision: "approved", pin: CALLER_PIN }),
    client({ note: noteRow({ status: "draft" }) }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("decide-fee-note-md - approve stamps the MD's signature", async () => {
  const fake = client();
  const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID, decision: "approved", pin: CALLER_PIN }), fake as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);

  const updateCall = fake.__log.filter((l) => l.table === "fee_notes").flatMap((l) => l.calls).find((c) => c[0] === "update");
  assertMatch(updateCall![1], /"status":"approved"/);
  assertMatch(updateCall![1], /"md_decided_by":"md-1"/);
});

Deno.test("decide-fee-note-md - a send-back resets both earlier signatures", async () => {
  const fake = client();
  const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID, decision: "rejected", remark: "Recheck the amount", pin: CALLER_PIN }), fake as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);

  const updateCall = fake.__log.filter((l) => l.table === "fee_notes").flatMap((l) => l.calls).find((c) => c[0] === "update");
  assertMatch(updateCall![1], /"status":"draft"/);
  assertMatch(updateCall![1], /"pr_signed_by":null/);
  assertMatch(updateCall![1], /"aa_signed_by":null/);
});
