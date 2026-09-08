import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const TARGET_ID = "target-1";

function client(caller: Record<string, unknown>, target: Record<string, unknown> | null) {
  return createFakeAdminClient({
    afc_users: [{ data: caller, error: null }, { data: target, error: null }],
    afc_user_teams: [{ data: null, error: null }],
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

Deno.test("update-staff-user - DGM can no longer edit any user, even a teammate", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Renamed" }),
    client({ id: CALLER_ID, role: "dgm", team: "BPDD", office: "delhi", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("update-staff-user - MD can no longer edit any user", async () => {
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Renamed" }),
    client({ id: CALLER_ID, role: "md", is_active: true }, { id: TARGET_ID, role: "srm", team: "BPDD" }) as never,
  );
  assertEquals(res.status, 403);
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

Deno.test("update-staff-user - a multi-team `teams` array replaces afc_user_teams, and teams[0] becomes the primary afc_users.team", async () => {
  const c = client({ id: CALLER_ID, role: "admin", is_active: true }, { id: TARGET_ID, role: "dgm", team: "BPDD" });
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Name", teams: ["HO", "BPDD"] }),
    c as never,
  );
  assertEquals(res.status, 200);

  const log = (c as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const profileUpdateLog = log.filter((l) => l.table === "afc_users").find((l) => l.calls[0]?.[0] === "update")!;
  const updatedFields = JSON.parse(profileUpdateLog.calls[0][1]);
  assertEquals(updatedFields.team, "HO");

  const teamsInsertLog = log.filter((l) => l.table === "afc_user_teams").find((l) => l.calls[0]?.[0] === "insert")!;
  const insertedTeams = JSON.parse(teamsInsertLog.calls[0][1]);
  assertEquals(insertedTeams, [
    { user_id: TARGET_ID, team: "HO" },
    { user_id: TARGET_ID, team: "BPDD" },
  ]);
});

Deno.test("update-staff-user - a singular `team` field (no `teams` array) still syncs afc_user_teams to one entry", async () => {
  const c = client({ id: CALLER_ID, role: "admin", is_active: true }, { id: TARGET_ID, role: "dgm", team: "BPDD" });
  const res = await handleRequest(
    req({ user_id: TARGET_ID, full_name: "Name", team: "HO" }),
    c as never,
  );
  assertEquals(res.status, 200);

  const log = (c as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const teamsInsertLog = log.filter((l) => l.table === "afc_user_teams").find((l) => l.calls[0]?.[0] === "insert")!;
  const insertedTeams = JSON.parse(teamsInsertLog.calls[0][1]);
  assertEquals(insertedTeams, [{ user_id: TARGET_ID, team: "HO" }]);
});
