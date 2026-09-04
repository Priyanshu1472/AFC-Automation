import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const CALLER_ID = "caller-1";
const APP_ID = "app-1";
const VALID_FLAGS = [{ field_key: "org_name", comment: "Name on PAN doesn't match the form." }];

function appRow(overrides: Record<string, unknown> = {}) {
  return { id: APP_ID, status: "po_review", ba_email: "ba@org.com", team: "BPDD", project_officer_id: CALLER_ID, dgm_id: null, sent_by: "sender-1", ...overrides };
}

function client(caller: Record<string, unknown>, app: Record<string, unknown> | null) {
  return createFakeAdminClient({
    afc_users: [{ data: caller, error: null }],
    empanelment_applications: [{ data: app, error: null }],
    ba_registrations: [{ data: { org_name: "Acme Org" }, error: null }],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/raise-empanelment-hold", { token: fakeJwt({ sub: CALLER_ID }), body });
}

const okFetch = (() => Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }))) as unknown as typeof fetch;

Deno.test("raise-empanelment-hold - rejects a role that's never allowed to raise a hold (e.g. cfo)", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, flags: VALID_FLAGS }), client({ id: CALLER_ID, role: "cfo", is_active: true }, appRow()) as never);
  assertEquals(res.status, 403);
});

Deno.test("raise-empanelment-hold - rejects an unflaggable field_key", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, flags: [{ field_key: "not_a_real_field", comment: "x" }] }),
    client({ id: CALLER_ID, role: "project_officer", is_active: true }, appRow()) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("raise-empanelment-hold - rejects a flag with no comment", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, flags: [{ field_key: "org_name", comment: "  " }] }),
    client({ id: CALLER_ID, role: "project_officer", is_active: true }, appRow()) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("raise-empanelment-hold - rejects empty flags array", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, flags: [] }),
    client({ id: CALLER_ID, role: "project_officer", is_active: true }, appRow()) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("raise-empanelment-hold - PO who isn't assigned to this application is rejected", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, flags: VALID_FLAGS }),
    client({ id: CALLER_ID, role: "project_officer", is_active: true }, appRow({ project_officer_id: "someone-else" })) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("raise-empanelment-hold - DGM from a different team is rejected", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, flags: VALID_FLAGS }),
    client({ id: CALLER_ID, role: "dgm", team: "BIID", is_active: true }, appRow({ status: "dgm_review", team: "BPDD" })) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("raise-empanelment-hold - PO can't raise a hold once it's moved past their stage", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, flags: VALID_FLAGS }),
    client({ id: CALLER_ID, role: "project_officer", is_active: true }, appRow({ status: "dgm_review" })) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("raise-empanelment-hold - success sets status to on_hold and records hold_origin_status", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const fake = client({ id: CALLER_ID, role: "project_officer", is_active: true }, appRow({ status: "po_review" }));
    const res = await handleRequest(req({ application_id: APP_ID, flags: VALID_FLAGS }), fake as never);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json, { success: true, status: "on_hold", flags_count: 1, email_sent: true });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("raise-empanelment-hold - MD can raise a hold while application is in md_review", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const res = await handleRequest(
      req({ application_id: APP_ID, flags: VALID_FLAGS }),
      client({ id: CALLER_ID, role: "md", is_active: true }, appRow({ status: "md_review" })) as never,
    );
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});
