import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const TARGET_ID = "target-1";

function client(caller: Record<string, unknown> | null, target: Record<string, unknown> | null) {
  return createFakeAdminClient({
    afc_users: [{ data: caller, error: null }, { data: target, error: null }],
    application_audit_log: [{ data: null, error: null }],
    notifications: [{ data: null, error: null }],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/set-user-status", { token: fakeJwt({ sub: CALLER_ID }), body });
}

Deno.test("set-user-status - rejects an unauthenticated caller", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), client(null, null) as never);
  assertEquals(res.status, 401);
});

Deno.test("set-user-status - rejects a deactivated caller", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, is_active: false }),
    client({ id: CALLER_ID, role: "admin", is_active: false }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("set-user-status - rejects a role that can never change status (e.g. cfo)", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, is_active: false }),
    client({ id: CALLER_ID, role: "cfo", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("set-user-status - requires is_active to be a boolean", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, is_active: "false" }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("set-user-status - rejects changing your own status", async () => {
  const res = await handleRequest(
    req({ user_id: CALLER_ID, is_active: false }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, null) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("set-user-status - unknown target -> 404", async () => {
  const res = await handleRequest(
    req({ user_id: "nope", is_active: false }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, null) as never,
  );
  assertEquals(res.status, 404);
});

Deno.test("set-user-status - DGM can no longer change any user's status, even a teammate", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, is_active: false }),
    client({ id: CALLER_ID, role: "dgm", team: "BPDD", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD", email: "x@afc.com", full_name: "X" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("set-user-status - MD can no longer change any user's status", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, is_active: false }),
    client({ id: CALLER_ID, role: "md", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD", email: "x@afc.com", full_name: "X" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("set-user-status - Admin can deactivate a DGM", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, is_active: false }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, { id: TARGET_ID, role: "dgm", team: "BPDD", email: "x@afc.com", full_name: "X" }) as never,
  );
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json, { success: true });
});
