import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";

function client(opts: {
  caller?: Record<string, unknown> | null;
  fullCaller?: Record<string, unknown> | null;
}) {
  const caller = opts.caller === undefined
    ? { id: CALLER_ID, role: "project_officer", team: "BPDD", office: "delhi", committee: null, is_active: true, email: "user@afc.com" }
    : opts.caller;
  const fullCaller = opts.fullCaller === undefined
    ? { full_name: "Test User", must_change_password: false }
    : opts.fullCaller;
  return createFakeAdminClient({
    afc_users: [{ data: caller, error: null }, { data: fullCaller, error: null }],
    afc_user_teams: [{ data: [], error: null }],
  });
}

function req() {
  return authedReq("https://x.com/log-password-changed", { token: fakeJwt({ sub: CALLER_ID }), body: {} });
}

Deno.test("log-password-changed - rejects an unauthenticated caller", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), client({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("log-password-changed - rejects a deactivated caller", async () => {
  const res = await handleRequest(req(), client({ caller: { id: CALLER_ID, role: "project_officer", is_active: false, email: "user@afc.com" } }) as never);
  assertEquals(res.status, 403);
});

Deno.test("log-password-changed - writes an audit log row for an ordinary password change", async () => {
  const c = client({ fullCaller: { full_name: "Test User", must_change_password: false } });
  const res = await handleRequest(req(), c as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { success: true });

  const auditCall = (c as unknown as { __log: { table: string; calls: string[][] }[] }).__log.find((l) => l.table === "application_audit_log");
  const insertCall = auditCall?.calls.find((call) => call[0] === "insert");
  const inserted = JSON.parse(insertCall![1]);
  assertEquals(inserted.action, "password_changed");
  assertEquals(inserted.action_by, CALLER_ID);
  assertEquals(inserted.comment, "Test User (user@afc.com) changed their password.");
});

Deno.test("log-password-changed - flags a first-time change from a temporary password", async () => {
  const c = client({ fullCaller: { full_name: "New Hire", must_change_password: true } });
  const res = await handleRequest(req(), c as never);
  assertEquals(res.status, 200);

  const auditCall = (c as unknown as { __log: { table: string; calls: string[][] }[] }).__log.find((l) => l.table === "application_audit_log");
  const insertCall = auditCall?.calls.find((call) => call[0] === "insert");
  const inserted = JSON.parse(insertCall![1]);
  assertEquals(inserted.comment, "New Hire (user@afc.com) set their password for the first time, from a temporary password.");
});
