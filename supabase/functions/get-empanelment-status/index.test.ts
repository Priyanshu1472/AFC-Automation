import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { createFakeAdminClient } from "../_shared/testHelpers.ts";

Deno.env.set("SUPABASE_ANON_KEY", "anon-secret");
const ALLOWED_RATE = { data: [{ allowed: true, wait_seconds: 0 }], error: null };

function req(body: unknown, headers: Record<string, string> = { apikey: "anon-secret" }) {
  return new Request("https://x.com/get-empanelment-status", { method: "POST", headers, body: JSON.stringify(body) });
}

Deno.test("get-empanelment-status - rejects without the anon key", async () => {
  const res = await handleRequest(req({ application_code: "12345" }, {}), createFakeAdminClient() as never);
  assertEquals(res.status, 401);
});

Deno.test("get-empanelment-status - rejects a non-5-digit code", async () => {
  const res = await handleRequest(req({ application_code: "123" }), createFakeAdminClient({}, { rpc: { check_rate_limit: ALLOWED_RATE } }) as never);
  assertEquals(res.status, 400);
});

Deno.test("get-empanelment-status - honors the rate limiter", async () => {
  const client = createFakeAdminClient({}, { rpc: { check_rate_limit: { data: [{ allowed: false, wait_seconds: 300 }], error: null } } });
  const res = await handleRequest(req({ application_code: "12345" }), client as never);
  assertEquals(res.status, 429);
});

Deno.test("get-empanelment-status - unknown code -> 400, not 404 (avoid leaking which codes exist via status)", async () => {
  const client = createFakeAdminClient(
    { empanelment_applications: [{ data: null, error: null }] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const res = await handleRequest(req({ application_code: "99999" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("get-empanelment-status - only exposes final_remark for accepted/rejected, not mid-pipeline statuses", async () => {
  const client = createFakeAdminClient(
    {
      empanelment_applications: [{ data: { id: "app-1", status: "dgm_review", application_code: "12345", created_at: "2026-01-01", md_remarks: "should not leak", dgm_comment: "recommend" }, error: null }],
      ba_registrations: [{ data: { org_name: "Acme Org" }, error: null }],
      empanelment_activity_log: [{ data: [{ id: "l1", actor_role: "dgm", action: "dgm_recommended", comment: "ok", created_at: "2026-01-02" }], error: null }],
    },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const res = await handleRequest(req({ application_code: "12345" }), client as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.final_remark, null);
  assertEquals(json.org_name, "Acme Org");
});

Deno.test("get-empanelment-status - exposes final_remark once accepted", async () => {
  const client = createFakeAdminClient(
    {
      empanelment_applications: [{ data: { id: "app-1", status: "accepted", application_code: "12345", created_at: "2026-01-01", md_remarks: "Welcome aboard", dgm_comment: null }, error: null }],
      ba_registrations: [{ data: { org_name: "Acme Org" }, error: null }],
      empanelment_activity_log: [{ data: [], error: null }],
    },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const res = await handleRequest(req({ application_code: "12345" }), client as never);
  const json = await res.json();
  assertEquals(json.final_remark, "Welcome aboard");
});

Deno.test("get-empanelment-status - includes open compliance flags only when on_hold", async () => {
  const client = createFakeAdminClient(
    {
      empanelment_applications: [{ data: { id: "app-1", status: "on_hold", application_code: "12345", created_at: "2026-01-01", md_remarks: null, dgm_comment: null }, error: null }],
      ba_registrations: [{ data: { org_name: "Acme Org" }, error: null }],
      empanelment_activity_log: [{ data: [], error: null }],
      compliance_flags: [{ data: [{ field_label: "PAN Number", comment: "Mismatch" }], error: null }],
    },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const res = await handleRequest(req({ application_code: "12345" }), client as never);
  const json = await res.json();
  assertEquals(json.flags, [{ field_label: "PAN Number", comment: "Mismatch" }]);
});
