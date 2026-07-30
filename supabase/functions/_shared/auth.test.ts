import { assertEquals } from "jsr:@std/assert@1";
import { getCallerProfile } from "./auth.ts";
import { createFakeAdminClient, fakeJwt } from "./testHelpers.ts";

function reqWithAuth(header?: string): Request {
  const headers: Record<string, string> = {};
  if (header !== undefined) headers["authorization"] = header;
  return new Request("https://example.com/fn", { method: "POST", headers });
}

Deno.test("getCallerProfile - missing Authorization header -> 401", async () => {
  const client = createFakeAdminClient();
  const result = await getCallerProfile(reqWithAuth(undefined), client as never);
  assertEquals(result, { ok: false, status: 401, error: "Unauthorized" });
});

Deno.test("getCallerProfile - non-Bearer scheme -> 401", async () => {
  const client = createFakeAdminClient();
  const result = await getCallerProfile(reqWithAuth("Basic abc123"), client as never);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test("getCallerProfile - malformed JWT -> 401 invalid payload", async () => {
  const client = createFakeAdminClient();
  const result = await getCallerProfile(reqWithAuth("Bearer not-a-jwt"), client as never);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 401);
    assertEquals(result.error, "Unauthorized — invalid token payload.");
  }
});

Deno.test("getCallerProfile - JWT with no sub claim -> 401", async () => {
  const client = createFakeAdminClient();
  const token = fakeJwt({ role: "authenticated" });
  const result = await getCallerProfile(reqWithAuth(`Bearer ${token}`), client as never);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test("getCallerProfile - caller row not found -> 403", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: null, error: { message: "no rows" } }],
  });
  const token = fakeJwt({ sub: "user-1" });
  const result = await getCallerProfile(reqWithAuth(`Bearer ${token}`), client as never);
  assertEquals(result, { ok: false, status: 403, error: "Caller account not found." });
});

Deno.test("getCallerProfile - deactivated account -> 403", async () => {
  const client = createFakeAdminClient({
    afc_users: [{
      data: { id: "user-1", role: "dgm", team: "BPDD", office: "delhi", is_active: false, email: "a@b.com" },
      error: null,
    }],
  });
  const token = fakeJwt({ sub: "user-1" });
  const result = await getCallerProfile(reqWithAuth(`Bearer ${token}`), client as never);
  assertEquals(result, { ok: false, status: 403, error: "Your account is deactivated." });
});

Deno.test("getCallerProfile - active caller -> ok with profile", async () => {
  const caller = { id: "user-1", role: "md", team: null, office: "delhi", is_active: true, email: "md@afc.com" };
  const client = createFakeAdminClient({ afc_users: [{ data: caller, error: null }] });
  const token = fakeJwt({ sub: "user-1" });
  const result = await getCallerProfile(reqWithAuth(`Bearer ${token}`), client as never);
  assertEquals(result, { ok: true, caller });
});
