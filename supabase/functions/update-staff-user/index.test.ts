import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const TARGET_ID = "target-1";

function client(caller: Record<string, unknown>, target: Record<string, unknown> | null) {
  return createFakeAdminClient({
    afc_users: [{ data: caller, error: null }, { data: target, error: null }],
    application_audit_log: [{ data: null, error: null }],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/update-staff-user", { token: fakeJwt({ sub: CALLER_ID }), body });
}

Deno.test("update-staff-user - rejects a role that can never edit users (e.g. cfo)", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Name" }),
    client({ id: CALLER_ID, role: "cfo", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("update-staff-user - requires a full name", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("update-staff-user - rejects self-edit via this endpoint", async () => {
  const res = await handleRequest(
    req({ user_id: CALLER_ID, full_name: "Me" }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, { id: CALLER_ID, role: "admin", team: null }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("update-staff-user - unknown target -> 404", async () => {
  const res = await handleRequest(
    req({ user_id: "nope", full_name: "Name" }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, null) as never,
  );
  assertEquals(res.status, 404);
});

Deno.test("update-staff-user - DGM can't edit a user outside their own team", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Name" }),
    client({ id: CALLER_ID, role: "dgm", team: "BPDD", office: "delhi", is_active: true }, { id: TARGET_ID, role: "srm", team: "CBBO" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("update-staff-user - DGM can't change a target's role", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Name", role: "agm" }),
    client({ id: CALLER_ID, role: "dgm", team: "BPDD", office: "delhi", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("update-staff-user - DGM can rename a teammate, forcing team/office to their own", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Renamed" }),
    client({ id: CALLER_ID, role: "dgm", team: "BPDD", office: "delhi", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 200);
});

Deno.test("update-staff-user - Admin can't set a target's role outside ADMIN_CREATABLE_ROLES (e.g. promote to admin)", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Name", role: "admin" }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("update-staff-user - Admin can edit an existing md account's name without a role in the body failing validation", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Renamed MD" }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, { id: TARGET_ID, role: "md", team: null }) as never,
  );
  assertEquals(res.status, 200);
});

Deno.test("update-staff-user - Admin changing a target's role to a valid one succeeds", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Name", role: "agm" }),
    client({ id: CALLER_ID, role: "admin", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 200);
});
