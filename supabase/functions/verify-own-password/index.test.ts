import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";

function client(opts: {
  caller?: Record<string, unknown> | null;
  signInResult?: { data: unknown; error: unknown };
}) {
  const caller = opts.caller === undefined
    ? { id: CALLER_ID, role: "project_officer", team: "BPDD", office: "delhi", committee: null, is_active: true, email: "user@afc.com" }
    : opts.caller;
  return createFakeAdminClient(
    { afc_users: [{ data: caller, error: null }], afc_user_teams: [{ data: [], error: null }] },
    { auth: { signInWithPassword: opts.signInResult ?? { data: { user: { id: CALLER_ID } }, error: null } } },
  );
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/verify-own-password", { token: fakeJwt({ sub: CALLER_ID }), body });
}

Deno.test("verify-own-password - rejects an unauthenticated caller", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), client({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("verify-own-password - rejects a deactivated caller", async () => {
  const res = await handleRequest(req({ password: "x" }), client({ caller: { id: CALLER_ID, role: "project_officer", is_active: false, email: "user@afc.com" } }) as never);
  assertEquals(res.status, 403);
});

Deno.test("verify-own-password - missing password -> 400", async () => {
  const res = await handleRequest(req({}), client({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("verify-own-password - correct password succeeds", async () => {
  const c = client({});
  const res = await handleRequest(req({ password: "CorrectPass123!" }), c as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { success: true });
  const authCalls = (c as unknown as { __authCalls: { method: string; args: unknown[] }[] }).__authCalls;
  const call = authCalls.find((c) => c.method === "signInWithPassword");
  assertEquals((call?.args[0] as { email: string }).email, "user@afc.com");
  assertEquals((call?.args[0] as { password: string }).password, "CorrectPass123!");
});

Deno.test("verify-own-password - wrong password -> 400 with a plain, non-leaking message", async () => {
  const res = await handleRequest(
    req({ password: "WrongPass123!" }),
    client({ signInResult: { data: null, error: { message: "Invalid login credentials" } } }) as never,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Your password is incorrect.");
});

// This is the actual bug being fixed: the OLD client-side check (a direct
// browser call to supabase.auth.signInWithPassword) started failing with a
// captcha error once Turnstile was enabled — this endpoint's whole reason
// to exist is going through the service-role key, which is exempt.
Deno.test("verify-own-password - never fails with a leaked captcha error even if that's what the sign-in call itself returned", async () => {
  const res = await handleRequest(
    req({ password: "CorrectPass123!" }),
    client({ signInResult: { data: null, error: { message: "captcha protection: request disallowed (no captcha_token found)" } } }) as never,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Your password is incorrect.");
});
