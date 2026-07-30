import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { createFakeAdminClient } from "../_shared/testHelpers.ts";

Deno.env.set("SUPABASE_ANON_KEY", "anon-secret");
const ALLOWED_RATE = { data: [{ allowed: true, wait_seconds: 0 }], error: null };

function req(body: unknown, headers: Record<string, string> = { apikey: "anon-secret" }) {
  return new Request("https://x.com/get-empanelment-correction-info", { method: "POST", headers, body: JSON.stringify(body) });
}

Deno.test("get-empanelment-correction-info - rejects without the anon key", async () => {
  const res = await handleRequest(req({ application_code: "12345" }, {}), createFakeAdminClient() as never);
  assertEquals(res.status, 401);
});

Deno.test("get-empanelment-correction-info - rejects a malformed code", async () => {
  const res = await handleRequest(req({ application_code: "abcde" }), createFakeAdminClient({}, { rpc: { check_rate_limit: ALLOWED_RATE } }) as never);
  assertEquals(res.status, 400);
});

Deno.test("get-empanelment-correction-info - honors the rate limiter", async () => {
  const client = createFakeAdminClient({}, { rpc: { check_rate_limit: { data: [{ allowed: false, wait_seconds: 120 }], error: null } } });
  const res = await handleRequest(req({ application_code: "12345" }), client as never);
  assertEquals(res.status, 429);
});

Deno.test("get-empanelment-correction-info - rejects an application that isn't on_hold", async () => {
  const client = createFakeAdminClient(
    { empanelment_applications: [{ data: { id: "app-1", status: "po_review" }, error: null }] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const res = await handleRequest(req({ application_code: "12345" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("get-empanelment-correction-info - on_hold application returns the registration and open flags", async () => {
  const client = createFakeAdminClient(
    {
      empanelment_applications: [{ data: { id: "app-1", status: "on_hold" }, error: null }],
      compliance_flags: [{ data: [{ field_key: "pan", field_label: "PAN Number", comment: "Mismatch" }], error: null }],
      ba_registrations: [{ data: { org_name: "Acme Org", pan: "AAAAA1111A" }, error: null }],
    },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const res = await handleRequest(req({ application_code: "12345" }), client as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.org_name, "Acme Org");
  assertEquals(json.flags.length, 1);
  assertEquals(json.registration.pan, "AAAAA1111A");
});
