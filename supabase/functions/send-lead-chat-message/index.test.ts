import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const LEAD_ID = "lead-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", office: "delhi", committee: null, is_active: true, email: "caller@afc.com", pin_hash: null, full_name: "Caller One", ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return { id: LEAD_ID, status: "pmt_review", chat_opened_at: "2026-08-25T00:00:00Z", lead_number: "L-1", title: "Test Lead", ...overrides };
}

function buildClient(opts: {
  lead?: Record<string, unknown>;
  participant?: Record<string, unknown> | null;
  others?: { user_id: string }[];
  insertResult?: { data?: unknown; error?: unknown };
}) {
  return createFakeAdminClient({
    afc_users: [{ data: callerRow(), error: null }],
    leads: [{ data: opts.lead ?? leadRow(), error: null }],
    lead_chat_participants: [
      { data: opts.participant === undefined ? { id: "p-1" } : opts.participant, error: null },
      { data: opts.others ?? [], error: null },
    ],
    lead_chat_messages: [opts.insertResult ?? { data: { id: "msg-1" }, error: null }],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/send-lead-chat-message", { token: fakeJwt({ sub: CALLER_ID }), body });
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

Deno.test("missing lead_id -> 400", async () => {
  const res = await handleRequest(req({ message: "hello" }), buildClient({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("empty message -> 400", async () => {
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "   " }), buildClient({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("oversized message -> 400", async () => {
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "a".repeat(4001) }), buildClient({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("unknown lead -> 404", async () => {
  const client = createFakeAdminClient({ afc_users: [{ data: callerRow(), error: null }], leads: [{ data: null, error: null }] });
  const res = await handleRequest(req({ lead_id: "nope", message: "hi" }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("chat not yet opened -> 400", async () => {
  const client = buildClient({ lead: leadRow({ chat_opened_at: null }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "hi" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Chat isn't open for this lead yet.");
});

Deno.test("locked once the lead is md_approved", async () => {
  const client = buildClient({ lead: leadRow({ status: "md_approved" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "hi" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "This lead has been approved — the chat is closed.");
});

Deno.test("still open after an md_decline (not locked, only md_approved locks it)", async () => {
  const client = buildClient({ lead: leadRow({ status: "pa_action_required" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "hi" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("rejects a non-participant", async () => {
  const client = buildClient({ participant: null });
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "hi" }), client as never);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "You're not part of this lead's chat.");
});

Deno.test("success - a participant can post while the chat is open", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "Looks good to me." }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true });
});

type RpcCall = { name: string; args: Record<string, unknown> | undefined };

Deno.test("bumps a grouped chat_message notification for the other participants, excluding the sender", async () => {
  const client = buildClient({ others: [{ user_id: "other-1" }, { user_id: "other-2" }] });
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "Looks good to me." }), client as never);
  assertEquals(res.status, 200);
  const bumpCalls = (client as unknown as { __rpcCalls: RpcCall[] }).__rpcCalls.filter((c) => c.name === "bump_chat_notification");
  assertEquals(
    bumpCalls.map((c) => c.args?.p_user_id).sort(),
    ["other-1", "other-2"]
  );
  assertEquals(bumpCalls.every((c) => c.args?.p_link === `/leads/${LEAD_ID}`), true);
});

Deno.test("a mentioned participant gets a separate tag notification instead of the grouped one", async () => {
  const client = buildClient({ others: [{ user_id: "other-1" }, { user_id: "other-2" }] });
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "hi @other-1", mentioned_user_ids: ["other-1"] }), client as never);
  assertEquals(res.status, 200);
  const insertCall = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.find(
    (e) => e.table === "notifications" && e.calls.some((c) => c[0] === "insert")
  );
  const insertRows = JSON.parse(insertCall!.calls.find((c) => c[0] === "insert")![1]) as { user_id: string; title: string; kind: string }[];
  assertEquals(insertRows.map((r) => r.user_id), ["other-1"]);
  assertEquals(insertRows[0].title.includes("tagged you"), true);
  assertEquals(insertRows[0].kind, "chat_mention");

  const bumpCalls = (client as unknown as { __rpcCalls: RpcCall[] }).__rpcCalls.filter((c) => c.name === "bump_chat_notification");
  assertEquals(bumpCalls.map((c) => c.args?.p_user_id), ["other-2"]);
});

Deno.test("a mentioned_user_ids entry for someone outside the roster is ignored", async () => {
  const client = buildClient({ others: [{ user_id: "other-1" }] });
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "hi", mentioned_user_ids: ["not-a-participant"] }), client as never);
  assertEquals(res.status, 200);
  const insertCalls = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter(
    (e) => e.table === "notifications" && e.calls.some((c) => c[0] === "insert")
  );
  assertEquals(insertCalls.length, 0);
  const bumpCalls = (client as unknown as { __rpcCalls: RpcCall[] }).__rpcCalls.filter((c) => c.name === "bump_chat_notification");
  assertEquals(bumpCalls.map((c) => c.args?.p_user_id), ["other-1"]);
});

Deno.test("insert failure -> 500", async () => {
  const client = buildClient({ insertResult: { data: null, error: { message: "boom" } } });
  const res = await handleRequest(req({ lead_id: LEAD_ID, message: "hi" }), client as never);
  assertEquals(res.status, 500);
});
