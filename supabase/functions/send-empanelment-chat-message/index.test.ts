import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "sender-1";
const APPLICATION_ID = "app-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", office: "delhi", committee: null, is_active: true, email: "caller@afc.com", pin_hash: null, full_name: "Caller One", ...overrides };
}

function appRow(overrides: Record<string, unknown> = {}) {
  return { id: APPLICATION_ID, status: "po_review", sent_by: CALLER_ID, project_officer_id: "po-1", dgm_id: "dgm-1", ba_email: "ba@example.com", ...overrides };
}

function buildClient(opts: {
  app?: Record<string, unknown>;
  caller?: Record<string, unknown>;
  orgWide?: { id: string }[];
  insertResult?: { data?: unknown; error?: unknown };
}) {
  return createFakeAdminClient({
    afc_users: [
      { data: opts.caller ?? callerRow(), error: null },
      { data: opts.orgWide ?? [], error: null },
      { data: opts.caller ?? callerRow(), error: null },
    ],
    empanelment_applications: [{ data: opts.app ?? appRow(), error: null }],
    ba_registrations: [{ data: { org_name: "Acme Org" }, error: null }],
    empanelment_chat_messages: [opts.insertResult ?? { data: { id: "msg-1" }, error: null }],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/send-empanelment-chat-message", { token: fakeJwt({ sub: CALLER_ID }), body });
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

Deno.test("missing application_id -> 400", async () => {
  const res = await handleRequest(req({ message: "hello" }), buildClient({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("empty message -> 400", async () => {
  const res = await handleRequest(req({ application_id: APPLICATION_ID, message: "   " }), buildClient({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("oversized message -> 400", async () => {
  const res = await handleRequest(req({ application_id: APPLICATION_ID, message: "a".repeat(4001) }), buildClient({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("unknown application -> 404", async () => {
  const client = createFakeAdminClient({ afc_users: [{ data: callerRow(), error: null }], empanelment_applications: [{ data: null, error: null }] });
  const res = await handleRequest(req({ application_id: "nope", message: "hi" }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("closed once a final decision has been made", async () => {
  const client = buildClient({ app: appRow({ status: "accepted" }) });
  const res = await handleRequest(req({ application_id: APPLICATION_ID, message: "hi" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "A final decision has been made on this application — the chat is closed.");
});

Deno.test("rejects a non-participant, non-org-wide caller", async () => {
  const client = buildClient({ caller: callerRow({ id: "outsider", role: "associate_consultant" }), app: appRow() });
  const res = await handleRequest(req({ application_id: APPLICATION_ID, message: "hi" }), client as never);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "You're not part of this application's chat.");
});

Deno.test("an org-wide role (cfo/cs/md) can post even without a direct assignment", async () => {
  const client = buildClient({ caller: callerRow({ id: "cfo-1", role: "cfo" }) });
  const res = await handleRequest(req({ application_id: APPLICATION_ID, message: "hi" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("success - a direct participant can post while the chat is open", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ application_id: APPLICATION_ID, message: "Looks good to me." }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true });
});

Deno.test("notifies sent_by/PO/DGM plus org-wide roles, excluding the sender, as action_required", async () => {
  const client = buildClient({ orgWide: [{ id: "cfo-1" }, { id: "cs-1" }] });
  const res = await handleRequest(req({ application_id: APPLICATION_ID, message: "Looks good to me." }), client as never);
  assertEquals(res.status, 200);
  const notifyCall = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.find(
    (e) => e.table === "notifications" && e.calls.some((c) => c[0] === "insert")
  );
  const insertArgs = JSON.parse(notifyCall!.calls.find((c) => c[0] === "insert")![1]) as { user_id: string; type: string; link: string }[];
  assertEquals(insertArgs.map((r) => r.user_id).sort(), ["cfo-1", "cs-1", "dgm-1", "po-1"]);
  assertEquals(insertArgs.every((r) => r.type === "action_required"), true);
  assertEquals(insertArgs.every((r) => r.link === `/empanelment/${APPLICATION_ID}`), true);
});

Deno.test("insert failure -> 500", async () => {
  const client = buildClient({ insertResult: { data: null, error: { message: "boom" } } });
  const res = await handleRequest(req({ application_id: APPLICATION_ID, message: "hi" }), client as never);
  assertEquals(res.status, 500);
});
