import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { createFakeAdminClient, FakeResult } from "../_shared/testHelpers.ts";

Deno.env.set("SUPABASE_ANON_KEY", "anon-secret");
const ALLOWED_RATE = { data: [{ allowed: true, wait_seconds: 0 }], error: null };
const APP_ID = "app-1";

function formReq(fields: Record<string, string>, files: Record<string, { bytes: Uint8Array; name: string; type: string }> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const [slot, f] of Object.entries(files)) fd.set(slot, new File([f.bytes], f.name, { type: f.type }));
  return new Request("https://x.com/submit-empanelment-correction", { method: "POST", headers: { apikey: "anon-secret" }, body: fd });
}

function client(opts: {
  app?: Record<string, unknown> | null;
  openFlags?: { id: string; field_key: string }[];
  reg?: Record<string, unknown> | null;
  extraAppUpdates?: FakeResult[];
  extraRegUpdates?: FakeResult[];
  extraFlagUpdates?: FakeResult[];
}) {
  const app = opts.app === undefined ? { id: APP_ID, status: "on_hold", hold_origin_status: "po_review", team: "BPDD", project_officer_id: "po-1", dgm_id: null } : opts.app;
  const openFlags = opts.openFlags ?? [{ id: "flag-1", field_key: "phone" }];
  const reg = opts.reg === undefined ? { phone: "1111111111", documents: [] } : opts.reg;
  return createFakeAdminClient(
    {
      empanelment_applications: [{ data: app, error: null }, ...(opts.extraAppUpdates || [{ data: null, error: null }])],
      compliance_flags: [{ data: openFlags, error: null }, ...(opts.extraFlagUpdates || openFlags.map(() => ({ data: null, error: null })))],
      ba_registrations: [{ data: reg, error: null }, ...(opts.extraRegUpdates || [{ data: null, error: null }])],
    },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

Deno.test("submit-empanelment-correction - rejects without the anon key", async () => {
  const req = new Request("https://x.com/x", { method: "POST", body: new FormData() });
  const res = await handleRequest(req, client({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("submit-empanelment-correction - rejects a malformed application code", async () => {
  const res = await handleRequest(formReq({ app_code: "1" }), client({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("submit-empanelment-correction - unknown application code -> 400", async () => {
  const res = await handleRequest(formReq({ app_code: "12345" }), client({ app: null }) as never);
  assertEquals(res.status, 400);
});

Deno.test("submit-empanelment-correction - rejects an application that isn't on_hold", async () => {
  const res = await handleRequest(
    formReq({ app_code: "12345" }),
    client({ app: { id: APP_ID, status: "po_review" } }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("submit-empanelment-correction - rejects when there are no open flags", async () => {
  const res = await handleRequest(
    formReq({ app_code: "12345", field_keys: JSON.stringify(["phone"]), clarification: "fixed it" }),
    client({ openFlags: [] }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("submit-empanelment-correction - requires a clarification", async () => {
  const res = await handleRequest(
    formReq({ app_code: "12345", field_keys: JSON.stringify(["phone"]), phone: "9876543210" }),
    client({}) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("submit-empanelment-correction - rejects a field_key that isn't actually open", async () => {
  const res = await handleRequest(
    formReq({ app_code: "12345", field_keys: JSON.stringify(["pan"]), clarification: "x", pan: "AAAAA1111A" }),
    client({ openFlags: [{ id: "flag-1", field_key: "phone" }] }) as never,
  );
  const json = await res.json();
  assertEquals(res.status, 400);
  assertStringIncludes(json.error, "not currently flagged");
});

Deno.test("submit-empanelment-correction - rejects an invalid corrected value (bad phone format)", async () => {
  const res = await handleRequest(
    formReq({ app_code: "12345", field_keys: JSON.stringify(["phone"]), clarification: "x", phone: "123" }),
    client({}) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("submit-empanelment-correction - text field correction succeeds and resumes at hold_origin_status", async () => {
  const res = await handleRequest(
    formReq({ app_code: "12345", field_keys: JSON.stringify(["phone"]), clarification: "typo fixed", phone: "9876543210" }),
    client({}) as never,
  );
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json, { success: true, corrected_count: 1 });
});

Deno.test("submit-empanelment-correction - falls back to po_review when hold_origin_status is missing", async () => {
  const res = await handleRequest(
    formReq({ app_code: "12345", field_keys: JSON.stringify(["phone"]), clarification: "typo fixed", phone: "9876543210" }),
    client({ app: { id: APP_ID, status: "on_hold", hold_origin_status: null, team: "BPDD", project_officer_id: "po-1", dgm_id: null } }) as never,
  );
  assertEquals(res.status, 200);
});

Deno.test("submit-empanelment-correction - doc correction requires a replacement file", async () => {
  const res = await handleRequest(
    formReq({ app_code: "12345", field_keys: JSON.stringify(["doc:panCopy"]), clarification: "re-uploading" }),
    client({ openFlags: [{ id: "flag-1", field_key: "doc:panCopy" }] }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("submit-empanelment-correction - doc correction with a valid PDF succeeds", async () => {
  const res = await handleRequest(
    formReq(
      { app_code: "12345", field_keys: JSON.stringify(["doc:panCopy"]), clarification: "re-uploading" },
      { "doc:panCopy": { bytes: PDF_BYTES, name: "pan.pdf", type: "application/pdf" } },
    ),
    client({ openFlags: [{ id: "flag-1", field_key: "doc:panCopy" }] }) as never,
  );
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.corrected_count, 1);
});
