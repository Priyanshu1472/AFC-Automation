import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

const CFO_ID = "cfo-1";
const INVOICE_ID = "inv-1";
const CALLER_PIN = "1234";
const CFO_PIN_HASH = await hashPin(CALLER_PIN, CFO_ID);

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return { id: INVOICE_ID, project_id: "proj-1", invoice_number: "INV-001", status: "pending_cfo", ...overrides };
}

function client(opts: {
  caller?: Record<string, unknown>;
  invoice?: Record<string, unknown> | null;
} = {}) {
  const invoice = opts.invoice === undefined ? invoiceRow() : opts.invoice;
  return createFakeAdminClient(
    {
      afc_users: [{ data: opts.caller ?? { id: CFO_ID, role: "cfo", is_active: true, email: "cfo@afc.com", pin_hash: CFO_PIN_HASH }, error: null }],
      client_invoices: [{ data: invoice, error: null }, { data: {}, error: null }],
      notifications: [{ data: {}, error: null }],
    },
    { rpc: { monitoring_team_ids: { data: ["pr-1", "reviewer-1"], error: null } } },
  );
}

function req(body: Record<string, unknown>, token = fakeJwt({ sub: CFO_ID })) {
  return authedReq("https://x.com/decide-client-invoice", { token, body });
}

Deno.test("decide-client-invoice - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), client() as never);
  assertEquals(res.status, 200);
});

Deno.test("decide-client-invoice - non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), client() as never);
  assertEquals(res.status, 405);
});

Deno.test("decide-client-invoice - only cfo can decide", async () => {
  const res = await handleRequest(
    req({ invoice_id: INVOICE_ID, decision: "approved", pin: CALLER_PIN }),
    client({ caller: { id: "pr-1", role: "project_officer", is_active: true, email: "pr@afc.com", pin_hash: CFO_PIN_HASH } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("decide-client-invoice - invalid decision is rejected", async () => {
  const res = await handleRequest(req({ invoice_id: INVOICE_ID, decision: "maybe", pin: CALLER_PIN }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("decide-client-invoice - a rejection requires a remark", async () => {
  const res = await handleRequest(req({ invoice_id: INVOICE_ID, decision: "rejected", pin: CALLER_PIN }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("decide-client-invoice - wrong PIN is rejected", async () => {
  const res = await handleRequest(req({ invoice_id: INVOICE_ID, decision: "approved", pin: "0000" }), client() as never);
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "Incorrect PIN.");
});

Deno.test("decide-client-invoice - an invoice not pending_cfo can't be decided", async () => {
  const res = await handleRequest(
    req({ invoice_id: INVOICE_ID, decision: "approved", pin: CALLER_PIN }),
    client({ invoice: invoiceRow({ status: "raised" }) }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("decide-client-invoice - approve stamps the CFO's signature", async () => {
  const fake = client();
  const res = await handleRequest(req({ invoice_id: INVOICE_ID, decision: "approved", pin: CALLER_PIN }), fake as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);

  const updateCall = fake.__log.filter((l) => l.table === "client_invoices").flatMap((l) => l.calls).find((c) => c[0] === "update");
  assertMatch(updateCall![1], /"status":"raised"/);
  assertMatch(updateCall![1], /"cfo_decided_by":"cfo-1"/);
});

Deno.test("decide-client-invoice - reject sends it back with a remark", async () => {
  const fake = client();
  const res = await handleRequest(req({ invoice_id: INVOICE_ID, decision: "rejected", remark: "Amount is wrong", pin: CALLER_PIN }), fake as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);

  const updateCall = fake.__log.filter((l) => l.table === "client_invoices").flatMap((l) => l.calls).find((c) => c[0] === "update");
  assertMatch(updateCall![1], /"status":"rejected"/);
  assertMatch(updateCall![1], /"cfo_remark":"Amount is wrong"/);
});
