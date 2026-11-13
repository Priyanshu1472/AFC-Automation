import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const TARGET_ID = "target-1";

function client(opts: {
  caller?: Record<string, unknown> | null;
  target?: Record<string, unknown> | null;
  adminCount?: number | null;
  deleteUserResult?: { data: unknown; error: unknown };
}) {
  const caller = opts.caller === undefined ? { id: CALLER_ID, role: "admin", team: null, office: null, is_active: true } : opts.caller;
  const target = opts.target === undefined ? { id: TARGET_ID, full_name: "Jane Doe", email: "jane@afc.com", role: "project_officer", is_active: true } : opts.target;
  return createFakeAdminClient(
    {
      afc_users: [
        { data: caller, error: null },
        { data: target, error: null },
        { data: null, error: null, count: opts.adminCount ?? 2 },
      ],
      application_audit_log: [{ data: null, error: null }],
    },
    { auth: { deleteUser: opts.deleteUserResult ?? { data: {}, error: null } } },
  );
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/delete-staff-user", { token: fakeJwt({ sub: CALLER_ID }), body });
}

Deno.test("delete-staff-user - rejects an unauthenticated caller", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), client({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("delete-staff-user - rejects a non-admin caller", async () => {
  const res = await handleRequest(req({ user_id: TARGET_ID }), client({ caller: { id: CALLER_ID, role: "dgm", team: "BPDD", is_active: true } }) as never);
  assertEquals(res.status, 403);
});

Deno.test("delete-staff-user - rejects a deactivated caller", async () => {
  const res = await handleRequest(req({ user_id: TARGET_ID }), client({ caller: { id: CALLER_ID, role: "admin", is_active: false } }) as never);
  assertEquals(res.status, 403);
});

Deno.test("delete-staff-user - missing user_id -> 400", async () => {
  const res = await handleRequest(req({}), client({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("delete-staff-user - rejects deleting your own account", async () => {
  const res = await handleRequest(req({ user_id: CALLER_ID }), client({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("delete-staff-user - unknown target -> 404", async () => {
  const res = await handleRequest(req({ user_id: TARGET_ID }), client({ target: null }) as never);
  assertEquals(res.status, 404);
});

Deno.test("delete-staff-user - blocks deleting the last active Admin", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID }),
    client({ target: { id: TARGET_ID, full_name: "Admin Two", email: "admin2@afc.com", role: "admin", is_active: true }, adminCount: 0 }) as never,
  );
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error.includes("At least one active Admin"), true);
});

Deno.test("delete-staff-user - allows deleting an Admin when another active Admin remains", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID }),
    client({ target: { id: TARGET_ID, full_name: "Admin Two", email: "admin2@afc.com", role: "admin", is_active: true }, adminCount: 1 }) as never,
  );
  assertEquals(res.status, 200);
});

Deno.test("delete-staff-user - a user with no history is deleted cleanly", async () => {
  const c = client({});
  const res = await handleRequest(req({ user_id: TARGET_ID }), c as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { success: true });
  const authCalls = (c as unknown as { __authCalls: { method: string; args: unknown[] }[] }).__authCalls;
  assertEquals(authCalls.some((c) => c.method === "deleteUser" && c.args[0] === TARGET_ID), true);
});

Deno.test("delete-staff-user - a user with existing records (FK violation) gets a clear 'deactivate instead' error, not a raw DB error", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID }),
    client({ deleteUserResult: { data: null, error: { message: "update or delete on table \"afc_users\" violates foreign key constraint \"leads_created_by_fkey\"" } } }) as never,
  );
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error.includes("Jane Doe"), true);
  assertEquals(json.error.includes("Deactivate"), true);
});

Deno.test("delete-staff-user - an unexpected delete failure returns a generic 500, not a leaked error", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID }),
    client({ deleteUserResult: { data: null, error: { message: "network hiccup" } } }) as never,
  );
  assertEquals(res.status, 500);
});

Deno.test("delete-staff-user - logs the deletion to the audit log", async () => {
  const c = client({});
  await handleRequest(req({ user_id: TARGET_ID }), c as never);
  const auditCall = (c as unknown as { __log: { table: string; calls: string[][] }[] }).__log
    .find((entry) => entry.table === "application_audit_log");
  const insertCall = auditCall?.calls.find((call) => call[0] === "insert");
  assertEquals(insertCall !== undefined, true);
  assertEquals(insertCall?.[1].includes("user_deleted"), true);
});
