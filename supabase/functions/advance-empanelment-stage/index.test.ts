import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const CALLER_ID = "caller-1";
const APP_ID = "app-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", office: "delhi", is_active: true, email: "caller@afc.com", ...overrides };
}

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID, status: "po_review", ba_email: "ba@org.com", team: "BPDD",
    project_officer_id: CALLER_ID, dgm_id: null, sent_by: "sender-1",
    cfo_reviewed: false, cs_reviewed: false, ...overrides,
  };
}

const ALLOWED_RATE = { data: [{ allowed: true, wait_seconds: 0 }], error: null };
const BA_DATA = { id: "ba-1", org_name: "Acme Org", contact_person: "Jane Doe", designation: "Director", reg_address: "1 Main St", sectors_served: ["Agri"] };

// Every call goes through the same app-lookup / ba-lookup preamble, so tests
// seed `empanelment_applications` and `ba_registrations` with that first
// entry, then append whatever the specific action needs afterward.
function buildClient(opts: {
  caller?: Record<string, unknown>;
  app?: Record<string, unknown>;
  ba?: Record<string, unknown> | null;
  routes?: Record<string, FakeResult[]>;
  rpc?: Record<string, FakeResult>;
  auth?: Parameters<typeof createFakeAdminClient>[1] extends { auth?: infer A } ? A : never;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [{ data: opts.caller ?? callerRow(), error: null }, ...(routes.afc_users || [])];
  routes.empanelment_applications = [{ data: opts.app ?? appRow(), error: null }, ...(routes.empanelment_applications || [])];
  routes.ba_registrations = [{ data: opts.ba === undefined ? BA_DATA : opts.ba, error: null }, ...(routes.ba_registrations || [])];
  return createFakeAdminClient(routes, { rpc: { check_rate_limit: ALLOWED_RATE, ...(opts.rpc || {}) }, auth: opts.auth });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/advance-empanelment-stage", { token: fakeJwt({ sub: CALLER_ID }), body });
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

Deno.test("handleRequest - unknown application_id -> 404", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow(), error: null }],
    empanelment_applications: [{ data: null, error: null }],
  });
  const res = await handleRequest(req({ application_id: "nope", action: "po_forward" }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - unknown action -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ application_id: APP_ID, action: "not_a_real_action" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'Unknown action "not_a_real_action".');
});

// ── po_forward ──────────────────────────────────────────────
Deno.test("po_forward - rejects a caller who isn't the assigned PO", async () => {
  const client = buildClient({ app: appRow({ project_officer_id: "someone-else" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "po_forward", comment: "ok" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("po_forward - rejects when application isn't in po_review", async () => {
  const client = buildClient({ app: appRow({ status: "cfo_cs_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "po_forward", comment: "ok" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("po_forward - requires a comment", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ application_id: APP_ID, action: "po_forward" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("po_forward - success moves to cfo_cs_review and notifies both CFO and CS", async () => {
  const client = buildClient({ routes: { afc_users: [{ data: [{ id: "cfo-1" }], error: null }, { data: [{ id: "cs-1" }], error: null }] } });
  const res = await handleRequest(req({ application_id: APP_ID, action: "po_forward", comment: "please review" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "cfo_cs_review" });
});

// ── cfo_review / cs_review ──────────────────────────────────
Deno.test("cfo_review - rejects a non-CFO caller", async () => {
  const client = buildClient({ caller: callerRow({ role: "cs" }), app: appRow({ status: "cfo_cs_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "cfo_review", comment: "ok" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("cfo_review - rejects a second review from the same CFO", async () => {
  const client = buildClient({ caller: callerRow({ role: "cfo" }), app: appRow({ status: "cfo_cs_review", cfo_reviewed: true }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "cfo_review", comment: "ok" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("cfo_review - first of the pair leaves status at cfo_cs_review (not yet forwarded)", async () => {
  const client = buildClient({ caller: callerRow({ role: "cfo" }), app: appRow({ status: "cfo_cs_review", cs_reviewed: false }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "cfo_review", comment: "looks fine" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "cfo_cs_review", forwarded: false });
});

Deno.test("cfo_review - second of the pair (CS already done) forwards to po_final_review", async () => {
  const client = buildClient({
    caller: callerRow({ role: "cfo" }),
    app: appRow({ status: "cfo_cs_review", cs_reviewed: true }),
    routes: { afc_users: [{ data: { email: "po@afc.com" }, error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "cfo_review", comment: "looks fine" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "po_final_review", forwarded: true });
});

Deno.test("cs_review - rejects a non-CS caller", async () => {
  const client = buildClient({ caller: callerRow({ role: "cfo" }), app: appRow({ status: "cfo_cs_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "cs_review", comment: "ok" }), client as never);
  assertEquals(res.status, 403);
});

// ── po_resend_cfo_cs ─────────────────────────────────────────
Deno.test("po_resend_cfo_cs - resets both review flags and goes back to cfo_cs_review", async () => {
  const client = buildClient({
    app: appRow({ status: "po_final_review" }),
    routes: { afc_users: [{ data: [{ id: "cfo-1" }], error: null }, { data: [{ id: "cs-1" }], error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "po_resend_cfo_cs" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "cfo_cs_review" });
});

Deno.test("po_resend_cfo_cs - wrong status rejected", async () => {
  const client = buildClient({ app: appRow({ status: "po_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "po_resend_cfo_cs" }), client as never);
  assertEquals(res.status, 400);
});

// ── po_final_forward ─────────────────────────────────────────
Deno.test("po_final_forward - no assigned DGM notifies the whole team's DGM role", async () => {
  const client = buildClient({
    app: appRow({ status: "po_final_review", dgm_id: null }),
    routes: { afc_users: [{ data: [{ email: "dgm@afc.com" }], error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "po_final_forward" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "dgm_review" });
});

Deno.test("po_final_forward - specific DGM assigned notifies that user directly", async () => {
  const client = buildClient({
    app: appRow({ status: "po_final_review", dgm_id: "dgm-1" }),
    routes: { afc_users: [{ data: { email: "dgm@afc.com" }, error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "po_final_forward" }), client as never);
  assertEquals(res.status, 200);
});

// ── dgm_recommend / dgm_send_back ────────────────────────────
Deno.test("dgm_recommend - rejects a DGM from a different team", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm", team: "CBBO" }), app: appRow({ status: "dgm_review", team: "BPDD" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "dgm_recommend", comment: "ok" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("dgm_recommend - success moves to md_review", async () => {
  const client = buildClient({
    caller: callerRow({ role: "dgm", team: "BPDD" }),
    app: appRow({ status: "dgm_review" }),
    routes: { afc_users: [{ data: [{ email: "md@afc.com" }], error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "dgm_recommend", comment: "recommend" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "md_review" });
});

Deno.test("dgm_send_back - returns application to po_final_review", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm", team: "BPDD" }), app: appRow({ status: "dgm_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "dgm_send_back" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "po_final_review" });
});

Deno.test("dgm_reject - always forbidden regardless of role/status, DGMs can't reject directly anymore", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm", team: "BPDD" }), app: appRow({ status: "dgm_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "dgm_reject" }), client as never);
  assertEquals(res.status, 403);
  assertStringIncludesForbidden(await res.json());
});

function assertStringIncludesForbidden(body: { error: string }) {
  assert(body.error.includes("DGMs can no longer reject"));
}

// ── md_send_back ─────────────────────────────────────────────
Deno.test("md_send_back - rejects a non-MD caller", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm" }), app: appRow({ status: "md_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_send_back" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("md_send_back - success returns application to dgm_review", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review", dgm_id: "dgm-1" }),
    routes: { afc_users: [{ data: { email: "dgm@afc.com" }, error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_send_back" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "dgm_review" });
});

// ── md_reject (OTP gated) ────────────────────────────────────
Deno.test("md_reject - rejects a non-MD caller", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm" }), app: appRow({ status: "md_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_reject", comment: "no", otp: "123456" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("md_reject - requires rejection remarks", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), app: appRow({ status: "md_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_reject", otp: "123456" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("md_reject - invalid OTP blocks the rejection even with a valid comment", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review" }),
    routes: { empanelment_action_otps: [{ data: null, error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_reject", comment: "not good enough", otp: "000000" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Invalid or expired verification code. Please request a new one.");
});

Deno.test("md_reject - valid OTP rejects the application and emails the BA", async () => {
  const hash = await sha256Hex("999999");
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review" }),
    routes: {
      empanelment_action_otps: [{ data: { id: "row1", otp_hash: hash, expires_at: future() }, error: null }, { data: null, error: null }],
      afc_users: [{ data: [{ id: "teammate-1" }], error: null }],
    },
  });
  await withFetch(resendOkFetch, async () => {
    const res = await handleRequest(req({ application_id: APP_ID, action: "md_reject", comment: "not aligned", otp: "999999" }), client as never);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.status, "rejected");
  });
});

// ── md_accept (OTP gated) ─────────────────────────────────────
Deno.test("md_accept - rejects a non-MD caller", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm" }), app: appRow({ status: "md_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "good", otp: "123456" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("md_accept - wrong application status rejected", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), app: appRow({ status: "dgm_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "good", otp: "123456" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("md_accept - invalid OTP blocks acceptance", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review" }),
    routes: { empanelment_action_otps: [{ data: null, error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "great fit", otp: "000000" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("md_accept - valid OTP accepts, reuses an existing BA login (no new account), and skips the letter when the logo can't be fetched", async () => {
  const hash = await sha256Hex("111222");
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review" }),
    routes: {
      empanelment_action_otps: [{ data: { id: "row1", otp_hash: hash, expires_at: future() }, error: null }, { data: null, error: null }],
      afc_users: [{ data: { id: "existing-ba-user" }, error: null }, { data: [{ id: "teammate-1" }], error: null }],
    },
  });
  await withFetch(logoFailsEmailOkFetch, async () => {
    const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "approved", otp: "111222" }), client as never);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.status, "accepted");
    assertEquals(json.ba_account_created, false);
  });
});

Deno.test("md_accept - valid OTP accepts and provisions a brand-new BA portal login when none exists", async () => {
  const hash = await sha256Hex("333444");
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review" }),
    routes: {
      empanelment_action_otps: [{ data: { id: "row1", otp_hash: hash, expires_at: future() }, error: null }, { data: null, error: null }],
      afc_users: [
        { data: null, error: null }, // no existing BA account
        { data: [{ id: "teammate-1" }], error: null },
      ],
    },
    auth: { createUser: { data: { user: { id: "new-ba-user" } }, error: null } },
  });
  await withFetch(logoFailsEmailOkFetch, async () => {
    const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "approved", otp: "333444" }), client as never);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.ba_account_created, true);
    const created = (client as unknown as { __authCalls: { method: string }[] }).__authCalls.find((c) => c.method === "createUser");
    assert(created);
  });
});

// ── helpers ──────────────────────────────────────────────────
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function future(): string {
  return new Date(Date.now() + 60_000).toISOString();
}

function withFetch(impl: typeof fetch, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const resendOkFetch = (() => Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }))) as unknown as typeof fetch;

// Logo fetch (GET, public-assets storage URL) fails -> tryBuildEmpanelmentLetter
// bails out to null gracefully; Resend email send still succeeds.
const logoFailsEmailOkFetch = ((url: string, init?: RequestInit) => {
  if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
  return Promise.resolve(new Response("not found", { status: 404 }));
}) as unknown as typeof fetch;
