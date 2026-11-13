import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const CALLER_ID = "dgm-1";
const MD_ID = "md-1";
const APP_ID = "app-1";
const CALLER_PIN = "1234";
const CALLER_PIN_HASH = await hashPin(CALLER_PIN, CALLER_ID);
const MD_PIN_HASH = await hashPin(CALLER_PIN, MD_ID);
const MD_CALLER = { id: MD_ID, role: "md", team: null, is_active: true, email: "md@afc.com", pin_hash: MD_PIN_HASH };

// A real (tiny, valid) 1x1 PNG — needed because pdf-lib actually parses the
// logo bytes; garbage bytes make embedPng/embedJpg both throw.
const MINIMAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
function pngBytes(): Uint8Array {
  const bin = atob(MINIMAL_PNG_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID, status: "cfo_cs_review", ba_email: "ba@org.com", team: "BPDD",
    sent_by: "sender-1", dgm_id: CALLER_ID, application_code: "12345", provisional_letter_sent: false,
    provisional_request_status: null, provisional_requested_by: null,
    ...overrides,
  };
}
const pendingApp = (overrides: Record<string, unknown> = {}) => appRow({ provisional_request_status: "pending", provisional_requested_by: CALLER_ID, ...overrides });

function client(opts: {
  caller?: Record<string, unknown>;
  app?: Record<string, unknown> | null;
  reg?: Record<string, unknown> | null;
  // "request" looks up the MDs to notify (a list) where "approve" looks up
  // the signatory (one row) — the 2nd afc_users query differs by action.
  secondUsersQuery?: unknown;
}) {
  return createFakeAdminClient(
    {
      afc_users: [{ data: opts.caller ?? { id: CALLER_ID, role: "dgm", team: "BPDD", is_active: true, email: "dgm@afc.com", pin_hash: CALLER_PIN_HASH }, error: null }, { data: opts.secondUsersQuery ?? { full_name: "Priya Sharma", signature_path: null }, error: null }],
      empanelment_applications: [{ data: opts.app === undefined ? appRow() : opts.app, error: null }, { data: { count: 2 }, error: null }, { data: null, error: null }],
      ba_registrations: [{ data: opts.reg === undefined ? { org_name: "Acme Org", contact_person: "Jane Doe", designation: "Director", reg_address: "1 Main St" } : opts.reg, error: null }],
    },
    { rpc: { check_rate_limit: { data: [{ allowed: true, wait_seconds: 0 }], error: null } } },
  );
}

function req(body: Record<string, unknown>, sub = CALLER_ID) {
  return authedReq("https://x.com/send-provisional-letter", { token: fakeJwt({ sub }), body: { pin: CALLER_PIN, ...body } });
}
const mdReq = (body: Record<string, unknown>) => req(body, MD_ID);

function stubFetch(logoOk = true) {
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    return Promise.resolve(logoOk ? new Response(pngBytes(), { status: 200 }) : new Response("not found", { status: 404 }));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

Deno.test("send-provisional-letter - an unknown/missing action is rejected", async () => {
  const res = await handleRequest(req({ application_id: APP_ID }), client({}) as never);
  assertEquals(res.status, 400);
});

// ── request (advisor) ───────────────────────────────────────────────────
Deno.test("request - the MD can't request (only the advisor can)", async () => {
  const res = await handleRequest(mdReq({ application_id: APP_ID, action: "request" }), client({ caller: MD_CALLER }) as never);
  assertEquals(res.status, 403);
});

Deno.test("request - rejects a DGM/AGM who isn't the assigned advisor", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, action: "request" }), client({ app: appRow({ dgm_id: "someone-else" }) }) as never);
  assertEquals(res.status, 403);
});

Deno.test("request - stays closed until the PO forwards to the CS", async () => {
  for (const status of ["sent", "filled", "po_review"]) {
    const res = await handleRequest(req({ application_id: APP_ID, action: "request" }), client({ app: appRow({ status }) }) as never);
    assertEquals(res.status, 400);
  }
  const heldEarly = await handleRequest(req({ application_id: APP_ID, action: "request" }), client({ app: appRow({ status: "on_hold", hold_origin_status: "po_review" }) }) as never);
  assertEquals(heldEarly.status, 400);
});

Deno.test("request - the assigned advisor's request marks it pending and does NOT send the letter", async () => {
  const fake = client({ secondUsersQuery: [{ id: MD_ID, email: "md@afc.com" }] });
  const restore = stubFetch();
  try {
    const res = await handleRequest(req({ application_id: APP_ID, action: "request", note: "Looks good" }), fake as never);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).requested, true);
    const update = fake.__log.find((l) => l.table === "empanelment_applications" && l.calls.some((c) => c[0] === "update"));
    const updated = JSON.parse(update!.calls.find((c) => c[0] === "update")![1]);
    assertEquals(updated.provisional_request_status, "pending");
    assertEquals(updated.provisional_letter_sent, undefined);
  } finally {
    restore();
  }
});

Deno.test("request - can't request twice while one is pending", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, action: "request" }), client({ app: pendingApp() }) as never);
  assertEquals(res.status, 400);
});

Deno.test("request - rejects when already sent", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, action: "request" }), client({ app: appRow({ provisional_letter_sent: true }) }) as never);
  assertEquals(res.status, 400);
});

// ── approve / decline (MD) ──────────────────────────────────────────────
Deno.test("approve - the advisor can't approve their own request", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, action: "approve" }), client({ app: pendingApp() }) as never);
  assertEquals(res.status, 403);
});

Deno.test("approve - the MD can't send without a pending request", async () => {
  const res = await handleRequest(mdReq({ application_id: APP_ID, action: "approve" }), client({ caller: MD_CALLER }) as never);
  assertEquals(res.status, 400);
});

Deno.test("approve - wrong PIN is rejected", async () => {
  const res = await handleRequest(mdReq({ application_id: APP_ID, action: "approve", pin: "0000" }), client({ caller: MD_CALLER, app: pendingApp() }) as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Incorrect PIN.");
});

Deno.test("approve - MD with correct PIN sends the PDF and marks the letter sent", async () => {
  const restore = stubFetch();
  try {
    const res = await handleRequest(mdReq({ application_id: APP_ID, action: "approve" }), client({ caller: MD_CALLER, app: pendingApp() }) as never);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(typeof json.ref, "string");
  } finally {
    restore();
  }
});

Deno.test("approve - logo fetch failure surfaces a clean 500, not a stack trace", async () => {
  const restore = stubFetch(false);
  try {
    const res = await handleRequest(mdReq({ application_id: APP_ID, action: "approve" }), client({ caller: MD_CALLER, app: pendingApp() }) as never);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, "Could not load logo. Please try again.");
  } finally {
    restore();
  }
});

Deno.test("decline - needs a reason", async () => {
  const res = await handleRequest(mdReq({ application_id: APP_ID, action: "decline", reason: "  " }), client({ caller: MD_CALLER, app: pendingApp() }) as never);
  assertEquals(res.status, 400);
});

Deno.test("decline - MD declines a pending request", async () => {
  const res = await handleRequest(mdReq({ application_id: APP_ID, action: "decline", reason: "Wait for CFO review" }), client({ caller: MD_CALLER, app: pendingApp() }) as never);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).declined, true);
});
