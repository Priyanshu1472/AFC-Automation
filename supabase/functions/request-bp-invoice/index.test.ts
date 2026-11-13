import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const PR_ID = "pr-1";
const BA_ID = "ba-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", office: "delhi", committee: null, is_active: true, email: "caller@afc.com", pin_hash: null, ...overrides };
}

const paidInvoice = { id: "inv-1", project_id: "proj-1", invoice_number: "AFC/1", status: "paid" };
const project = { id: "proj-1", lead_id: "lead-1" };
function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1", title: "Watershed DPR", client_name: "State Dept",
    assigned_ba_id: BA_ID, person_responsible_id: PR_ID, reviewer_id: "rev-1", recommending_authority_id: "ra-1",
    ...overrides,
  };
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/request-bp-invoice", { token: fakeJwt({ sub: CALLER_ID }), body });
}

function inserted(client: ReturnType<typeof createFakeAdminClient>, table: string) {
  return client.__log.filter((e) => e.table === table).some((e) => e.calls.some((c) => c[0] === "insert"));
}
function updated(client: ReturnType<typeof createFakeAdminClient>, table: string) {
  return client.__log.filter((e) => e.table === table).some((e) => e.calls.some((c) => c[0] === "update"));
}

Deno.test("OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), createFakeAdminClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), createFakeAdminClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("missing client_invoice_id -> 400", async () => {
  const client = createFakeAdminClient({ afc_users: [{ data: callerRow(), error: null }] });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("negative expected amount -> 400", async () => {
  const client = createFakeAdminClient({ afc_users: [{ data: callerRow({ id: PR_ID }), error: null }] });
  const res = await handleRequest(req({ client_invoice_id: "inv-1", expected_amount: -5 }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("unknown invoice -> 404", async () => {
  const client = createFakeAdminClient({ afc_users: [{ data: callerRow(), error: null }], client_invoices: [{ data: null, error: null }] });
  const res = await handleRequest(req({ client_invoice_id: "nope" }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("caller outside the lead's team -> 403", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow(), error: null }],
    client_invoices: [{ data: paidInvoice, error: null }],
    monitoring_projects: [{ data: project, error: null }],
    leads: [{ data: leadRow(), error: null }],
  });
  const res = await handleRequest(req({ client_invoice_id: "inv-1" }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("client hasn't paid yet -> 400", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow({ id: PR_ID }), error: null }],
    client_invoices: [{ data: { ...paidInvoice, status: "raised" }, error: null }],
    monitoring_projects: [{ data: project, error: null }],
    leads: [{ data: leadRow(), error: null }],
  });
  const res = await handleRequest(req({ client_invoice_id: "inv-1" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("project without a BP -> 400", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow({ id: PR_ID }), error: null }],
    client_invoices: [{ data: paidInvoice, error: null }],
    monitoring_projects: [{ data: project, error: null }],
    leads: [{ data: leadRow({ assigned_ba_id: null }), error: null }],
  });
  const res = await handleRequest(req({ client_invoice_id: "inv-1" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("first request creates the BP invoice row and alerts the BP", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow({ id: PR_ID }), error: null }, { data: { email: "bp@x.com", full_name: "BP Co" }, error: null }],
    client_invoices: [{ data: paidInvoice, error: null }],
    monitoring_projects: [{ data: project, error: null }],
    leads: [{ data: leadRow(), error: null }],
    bp_invoices: [{ data: null, error: null }, { data: { id: "bpi-1" }, error: null }],
  });
  const res = await handleRequest(req({ client_invoice_id: "inv-1", expected_amount: 50000 }), client as never);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.bp_invoice_id, "bpi-1");
  assertEquals(body.is_reminder, false);
  assertEquals(inserted(client, "bp_invoices"), true);
  assertEquals(inserted(client, "notifications"), true);
});

Deno.test("md can request even though not on the lead", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow({ role: "md" }), error: null }, { data: { email: "bp@x.com" }, error: null }],
    client_invoices: [{ data: paidInvoice, error: null }],
    monitoring_projects: [{ data: project, error: null }],
    leads: [{ data: leadRow(), error: null }],
    bp_invoices: [{ data: null, error: null }, { data: { id: "bpi-1" }, error: null }],
  });
  const res = await handleRequest(req({ client_invoice_id: "inv-1" }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("a second ask within 24h is refused", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow({ id: PR_ID }), error: null }, { data: { email: "bp@x.com" }, error: null }],
    client_invoices: [{ data: paidInvoice, error: null }],
    monitoring_projects: [{ data: project, error: null }],
    leads: [{ data: leadRow(), error: null }],
    bp_invoices: [{ data: { id: "bpi-1", status: "requested", requested_at: new Date().toISOString(), last_reminded_at: null, expected_amount: null }, error: null }],
  });
  const res = await handleRequest(req({ client_invoice_id: "inv-1" }), client as never);
  assertEquals(res.status, 400);
  assertEquals(updated(client, "bp_invoices"), false);
});

Deno.test("after 24h the call is a reminder, not a new row", async () => {
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow({ id: PR_ID }), error: null }, { data: { email: "bp@x.com" }, error: null }],
    client_invoices: [{ data: paidInvoice, error: null }],
    monitoring_projects: [{ data: project, error: null }],
    leads: [{ data: leadRow(), error: null }],
    bp_invoices: [
      { data: { id: "bpi-1", status: "requested", requested_at: old, last_reminded_at: null, expected_amount: 1000 }, error: null },
      { data: null, error: null },
    ],
  });
  const res = await handleRequest(req({ client_invoice_id: "inv-1" }), client as never);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.is_reminder, true);
  assertEquals(updated(client, "bp_invoices"), true);
  assertEquals(inserted(client, "bp_invoices"), false);
});

Deno.test("BP already submitted -> 400", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow({ id: PR_ID }), error: null }, { data: { email: "bp@x.com" }, error: null }],
    client_invoices: [{ data: paidInvoice, error: null }],
    monitoring_projects: [{ data: project, error: null }],
    leads: [{ data: leadRow(), error: null }],
    bp_invoices: [{ data: { id: "bpi-1", status: "received", requested_at: "2026-01-01T00:00:00Z" }, error: null }],
  });
  const res = await handleRequest(req({ client_invoice_id: "inv-1" }), client as never);
  assertEquals(res.status, 400);
});
