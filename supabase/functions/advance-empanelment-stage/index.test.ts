import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const CALLER_ID = "caller-1";
const APP_ID = "app-1";

// md_accept/md_reject tests below pass this PIN explicitly (there's no
// shared req() default the way advance-lead-stage has, since most actions
// here aren't PIN-gated) — must match callerRow()'s pin_hash.
const CALLER_PIN = "1234";
const CALLER_PIN_HASH = await hashPin(CALLER_PIN, CALLER_ID);

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", office: "delhi", is_active: true, email: "caller@afc.com", pin_hash: CALLER_PIN_HASH, ...overrides };
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
// The dgm_review stage belongs to the application's assigned advising
// authority (dgm_id) — a DGM or an AGM — not just any DGM on the team.
Deno.test("dgm_recommend - rejects a DGM who isn't the assigned advisor", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm", team: "BPDD" }), app: appRow({ status: "dgm_review", dgm_id: "other-dgm" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "dgm_recommend", comment: "ok" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("dgm_recommend - an AGM assigned as the advising authority can act", async () => {
  const client = buildClient({
    caller: callerRow({ role: "agm", team: "BPDD" }),
    app: appRow({ status: "dgm_review", dgm_id: CALLER_ID }),
    routes: { afc_users: [{ data: [{ email: "md@afc.com" }], error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "dgm_recommend", comment: "ok" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("dgm_recommend - success moves to md_review", async () => {
  const client = buildClient({
    caller: callerRow({ role: "dgm", team: "BPDD" }),
    app: appRow({ status: "dgm_review", dgm_id: CALLER_ID }),
    routes: { afc_users: [{ data: [{ email: "md@afc.com" }], error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "dgm_recommend", comment: "recommend" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "md_review" });
});

Deno.test("dgm_send_back - requires a comment", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm", team: "BPDD" }), app: appRow({ status: "dgm_review", dgm_id: CALLER_ID }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "dgm_send_back" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("dgm_send_back - returns application to po_final_review", async () => {
  const client = buildClient({ caller: callerRow({ role: "agm", team: "BPDD" }), app: appRow({ status: "dgm_review", dgm_id: CALLER_ID }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "dgm_send_back", comment: "please recheck the GST details" }), client as never);
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

Deno.test("md_send_back - requires a comment", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), app: appRow({ status: "md_review", dgm_id: "dgm-1" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_send_back" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("md_send_back - success returns application to dgm_review", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review", dgm_id: "dgm-1" }),
    routes: { afc_users: [{ data: { email: "dgm@afc.com" }, error: null }] },
  });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_send_back", comment: "please recheck the financials" }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, status: "dgm_review" });
});

// ── md_reject (PIN gated) ────────────────────────────────────
Deno.test("md_reject - rejects a non-MD caller", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm" }), app: appRow({ status: "md_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_reject", comment: "no", pin: CALLER_PIN }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("md_reject - requires rejection remarks", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), app: appRow({ status: "md_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_reject", pin: CALLER_PIN }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("md_reject - wrong PIN blocks the rejection even with a valid comment", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), app: appRow({ status: "md_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_reject", comment: "not good enough", pin: "0000" }), client as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Incorrect PIN.");
});

Deno.test("md_reject - correct PIN rejects the application and emails the BA", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review" }),
    routes: { afc_users: [{ data: [{ id: "teammate-1" }], error: null }] },
  });
  await withFetch(resendOkFetch, async () => {
    const res = await handleRequest(req({ application_id: APP_ID, action: "md_reject", comment: "not aligned", pin: CALLER_PIN }), client as never);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.status, "rejected");
  });
});

// ── md_accept (PIN gated) ─────────────────────────────────────
Deno.test("md_accept - rejects a non-MD caller", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm" }), app: appRow({ status: "md_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "good", pin: CALLER_PIN }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("md_accept - wrong application status rejected", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), app: appRow({ status: "dgm_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "good", pin: CALLER_PIN }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("md_accept - wrong PIN blocks acceptance", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }), app: appRow({ status: "md_review" }) });
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "great fit", pin: "0000" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("md_accept - correct PIN accepts, reuses an existing BA login (no new account), and skips the letter when the logo can't be fetched", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review" }),
    routes: {
      afc_users: [{ data: { id: "existing-ba-user", team: "Team 1" }, error: null }, { data: [{ id: "teammate-1" }], error: null }],
    },
  });
  await withFetch(logoFailsEmailOkFetch, async () => {
    const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "approved", pin: CALLER_PIN }), client as never);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.status, "accepted");
    assertEquals(json.ba_account_created, false);
  });
});

Deno.test("md_accept - correct PIN accepts and provisions a brand-new BA portal login when none exists", async () => {
  const client = buildClient({
    caller: callerRow({ role: "md" }),
    app: appRow({ status: "md_review" }),
    routes: {
      afc_users: [
        { data: null, error: null }, // no existing BA account
        { data: [{ id: "teammate-1" }], error: null },
      ],
    },
    auth: { createUser: { data: { user: { id: "new-ba-user" } }, error: null } },
  });
  await withFetch(logoFailsEmailOkFetch, async () => {
    const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept", comment: "approved", pin: CALLER_PIN }), client as never);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.ba_account_created, true);
    const created = (client as unknown as { __authCalls: { method: string }[] }).__authCalls.find((c) => c.method === "createUser");
    assert(created);
  });
});

// ── helpers ──────────────────────────────────────────────────
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
