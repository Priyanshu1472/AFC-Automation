import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { createFakeAdminClient } from "../_shared/testHelpers.ts";

Deno.env.set("SUPABASE_ANON_KEY", "anon-secret");
const ALLOWED_RATE = { data: [{ allowed: true, wait_seconds: 0 }], error: null };

const VALID_FIELDS: Record<string, string> = {
  app_code: "12345",
  orgName: "Acme Org",
  entityType: "Private Limited",
  contactPerson: "Jane Doe",
  designation: "Director",
  phone: "9876543210",
  email: "jane@acme.com",
  pan: "AAAAA1111A",
  ifscCode: "HDFC0001234",
  accountNumber: "123456789012",
  yearEstablished: "2010",
  companiesActStatus: "Compliant",
  companyStatus: "Active",
  bankName: "HDFC",
  bankBranch: "MG Road",
  coreExpertise: "Agri consulting",
  declared: "true",
};

function formReq(overrides: Record<string, string | null> = {}, files: Record<string, { bytes: Uint8Array; name: string; type: string }> = {}) {
  const fd = new FormData();
  const merged = { ...VALID_FIELDS, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== null) fd.set(k, v);
  }
  for (const [slot, f] of Object.entries(files)) {
    fd.set(slot, new File([f.bytes], f.name, { type: f.type }));
  }
  return new Request("https://x.com/submit-ba-form", { method: "POST", headers: { apikey: "anon-secret" }, body: fd });
}

function client(app: Record<string, unknown> | null) {
  return createFakeAdminClient(
    { empanelment_applications: [{ data: app, error: null }] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

Deno.test("submit-ba-form - rejects without the anon key", async () => {
  const req = new Request("https://x.com/submit-ba-form", { method: "POST", body: new FormData() });
  const res = await handleRequest(req, client({ id: "app-1", status: "sent" }) as never);
  assertEquals(res.status, 401);
});

Deno.test("submit-ba-form - rejects a malformed application code", async () => {
  const res = await handleRequest(formReq({ app_code: "1" }), client(null) as never);
  assertEquals(res.status, 400);
});

Deno.test("submit-ba-form - unknown application code -> 400", async () => {
  const res = await handleRequest(formReq({}), client(null) as never);
  assertEquals(res.status, 400);
});

Deno.test("submit-ba-form - an already-submitted code is rejected", async () => {
  const res = await handleRequest(formReq({}), client({ id: "app-1", status: "po_review", project_officer_id: "po-1" }) as never);
  const json = await res.json();
  assertEquals(res.status, 400);
  assertStringIncludes(json.error, "already been used");
});

Deno.test("submit-ba-form - rejects an invalid PAN", async () => {
  const res = await handleRequest(formReq({ pan: "not-a-pan" }), client({ id: "app-1", status: "sent" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("submit-ba-form - rejects an invalid IFSC", async () => {
  const res = await handleRequest(formReq({ ifscCode: "12345" }), client({ id: "app-1", status: "sent" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("submit-ba-form - rejects a year of establishment in the future", async () => {
  const res = await handleRequest(formReq({ yearEstablished: "3000" }), client({ id: "app-1", status: "sent" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("submit-ba-form - requires the declaration checkbox", async () => {
  const res = await handleRequest(formReq({ declared: "false" }), client({ id: "app-1", status: "sent" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("submit-ba-form - rejects a non-PDF upload", async () => {
  const res = await handleRequest(
    formReq({}, { panCopy: { bytes: new Uint8Array([1, 2, 3]), name: "pan.jpg", type: "image/jpeg" } }),
    client({ id: "app-1", status: "sent" }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("submit-ba-form - rejects a file whose bytes don't actually look like a PDF (spoofed mime type)", async () => {
  const res = await handleRequest(
    formReq({}, { panCopy: { bytes: new Uint8Array([1, 2, 3, 4]), name: "pan.pdf", type: "application/pdf" } }),
    client({ id: "app-1", status: "sent" }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("submit-ba-form - valid minimal submission succeeds and moves the application to po_review", async () => {
  const fake = client({ id: "app-1", status: "sent", project_officer_id: "po-1" });
  const res = await handleRequest(formReq({}, { panCopy: { bytes: PDF_BYTES, name: "pan.pdf", type: "application/pdf" } }), fake as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);
  assertEquals(json.documents_count, 1);
});
