import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const PROPOSAL_ID = "proposal-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", office: "delhi", committee: null, is_active: true, email: "caller@afc.com", pin_hash: null, ...overrides };
}

function proposalRow(overrides: Record<string, unknown> = {}) {
  return { id: PROPOSAL_ID, locked: false, chat_opened_at: "2026-09-01T00:00:00Z", lead: { submission_deadline: null }, ...overrides };
}

function buildClient(opts: {
  proposal?: Record<string, unknown>;
  participant?: Record<string, unknown> | null;
  insertResult?: { data?: unknown; error?: unknown };
}) {
  return createFakeAdminClient({
    afc_users: [{ data: callerRow(), error: null }],
    proposal_preparations: [{ data: opts.proposal ?? proposalRow(), error: null }],
    proposal_chat_participants: [{ data: opts.participant === undefined ? { id: "p-1" } : opts.participant, error: null }],
    proposal_chat_messages: [opts.insertResult ?? { data: { id: "msg-1" }, error: null }],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/send-proposal-chat-message", { token: fakeJwt({ sub: CALLER_ID }), body });
}

Deno.test("OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), buildClient({}) as never);
  assertEquals(res.status, 405);
});

Deno.test("unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("missing proposal_id -> 400", async () => {
  const res = await handleRequest(req({ message: "hello" }), buildClient({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("empty message -> 400", async () => {
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, message: "   " }), buildClient({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("oversized message -> 400", async () => {
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, message: "a".repeat(4001) }), buildClient({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("unknown proposal -> 404", async () => {
  const client = createFakeAdminClient({ afc_users: [{ data: callerRow(), error: null }], proposal_preparations: [{ data: null, error: null }] });
  const res = await handleRequest(req({ proposal_id: "nope", message: "hi" }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("chat not yet opened -> 400", async () => {
  const client = buildClient({ proposal: proposalRow({ chat_opened_at: null }) });
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, message: "hi" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Chat isn't open for this proposal yet.");
});

Deno.test("closed once the proposal is manually locked", async () => {
  const client = buildClient({ proposal: proposalRow({ locked: true }) });
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, message: "hi" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "This proposal is locked — the chat is closed.");
});

Deno.test("closed once the lead's submission deadline has passed, even if never manually locked", async () => {
  const client = buildClient({ proposal: proposalRow({ locked: false, lead: { submission_deadline: "2020-01-01T00:00:00Z" } }) });
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, message: "hi" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "This proposal is locked — the chat is closed.");
});

Deno.test("still open while not locked and the deadline (if any) hasn't passed yet, regardless of client_response", async () => {
  const client = buildClient({ proposal: proposalRow({ locked: false, lead: { submission_deadline: "2099-01-01T00:00:00Z" } }) });
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, message: "hi" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("rejects a non-participant", async () => {
  const client = buildClient({ participant: null });
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, message: "hi" }), client as never);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "You're not part of this proposal's chat.");
});

Deno.test("success - a participant can post while the chat is open", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, message: "Looks good to me." }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true });
});

Deno.test("insert failure -> 500", async () => {
  const client = buildClient({ insertResult: { data: null, error: { message: "boom" } } });
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, message: "hi" }), client as never);
  assertEquals(res.status, 500);
});
