import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { issueOtp, verifyOtp } from "./otp.ts";
import { createFakeAdminClient } from "./testHelpers.ts";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function withMockedFetch(impl: typeof fetch, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const ALLOWED_RATE = { data: [{ allowed: true, wait_seconds: 0 }], error: null };
const BLOCKED_RATE = (waitSeconds: number) => ({ data: [{ allowed: false, wait_seconds: waitSeconds }], error: null });

Deno.test("issueOtp - blocked by its own rate limit before ever emailing", async () => {
  Deno.env.set("RESEND_API_KEY", "key");
  const client = createFakeAdminClient({}, { rpc: { check_rate_limit: BLOCKED_RATE(600) } });
  await withMockedFetch(
    (() => {
      throw new Error("fetch should not be called when rate-limited");
    }) as unknown as typeof fetch,
    async () => {
      const result = await issueOtp(client as never, { userId: "u1", userEmail: "u1@afc.com", applicationId: "app1", action: "md_accept" });
      assertEquals(result.ok, false);
      if (!result.ok) assertStringIncludes(result.error, "Too many code requests");
    },
  );
});

Deno.test("issueOtp - insert failure surfaces a generic error, not the raw DB message", async () => {
  Deno.env.set("RESEND_API_KEY", "key");
  const client = createFakeAdminClient(
    { empanelment_action_otps: [{ data: null, error: null }, { data: null, error: { message: "constraint violation" } }] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const result = await issueOtp(client as never, { userId: "u1", userEmail: "u1@afc.com", applicationId: "app1", action: "md_accept" });
  assertEquals(result, { ok: false, error: "Could not generate a verification code. Please try again." });
});

Deno.test("issueOtp - email send failure is reported after a successful insert", async () => {
  Deno.env.set("RESEND_API_KEY", "key");
  const client = createFakeAdminClient(
    { empanelment_action_otps: [{ data: null, error: null }, { data: null, error: null }] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  await withMockedFetch(
    (() => Promise.resolve(new Response("down", { status: 500 }))) as typeof fetch,
    async () => {
      const result = await issueOtp(client as never, { userId: "u1", userEmail: "u1@afc.com", applicationId: "app1", action: "md_accept" });
      assertEquals(result, { ok: false, error: "Could not send the verification code email. Please try again." });
    },
  );
});

Deno.test("issueOtp - full success path emails the caller's own address", async () => {
  Deno.env.set("RESEND_API_KEY", "key");
  const client = createFakeAdminClient(
    { empanelment_action_otps: [{ data: null, error: null }, { data: null, error: null }] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  await withMockedFetch(
    ((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      assertEquals(body.to, ["dgm@afc.com"]);
      return Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    }) as unknown as typeof fetch,
    async () => {
      const result = await issueOtp(client as never, { userId: "u1", userEmail: "dgm@afc.com", applicationId: "app1", action: "provisional_letter" });
      assertEquals(result, { ok: true });
    },
  );
});

Deno.test("verifyOtp - blocked by its own rate limit returns false", async () => {
  const client = createFakeAdminClient({}, { rpc: { check_rate_limit: BLOCKED_RATE(300) } });
  const result = await verifyOtp(client as never, { userId: "u1", applicationId: "app1", action: "md_accept", otp: "123456" });
  assertEquals(result, false);
});

Deno.test("verifyOtp - rejects a non-6-digit code without touching the DB", async () => {
  const client = createFakeAdminClient({}, { rpc: { check_rate_limit: ALLOWED_RATE } });
  assertEquals(await verifyOtp(client as never, { userId: "u1", applicationId: "app1", action: "md_accept", otp: "12345" }), false);
  assertEquals(await verifyOtp(client as never, { userId: "u1", applicationId: "app1", action: "md_accept", otp: "abcdef" }), false);
  assertEquals(await verifyOtp(client as never, { userId: "u1", applicationId: "app1", action: "md_accept", otp: 123456 }), false);
});

Deno.test("verifyOtp - no unconsumed row for this user/app/action -> false", async () => {
  const client = createFakeAdminClient(
    { empanelment_action_otps: [{ data: null, error: null }] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const result = await verifyOtp(client as never, { userId: "u1", applicationId: "app1", action: "md_accept", otp: "123456" });
  assertEquals(result, false);
});

Deno.test("verifyOtp - expired code -> false even with a matching hash", async () => {
  const hash = await sha256Hex("123456");
  const client = createFakeAdminClient(
    { empanelment_action_otps: [{ data: { id: "row1", otp_hash: hash, expires_at: new Date(Date.now() - 60_000).toISOString() }, error: null }] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const result = await verifyOtp(client as never, { userId: "u1", applicationId: "app1", action: "md_accept", otp: "123456" });
  assertEquals(result, false);
});

Deno.test("verifyOtp - wrong code against a valid unexpired row -> false", async () => {
  const hash = await sha256Hex("111111");
  const client = createFakeAdminClient(
    { empanelment_action_otps: [{ data: { id: "row1", otp_hash: hash, expires_at: new Date(Date.now() + 60_000).toISOString() }, error: null }] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const result = await verifyOtp(client as never, { userId: "u1", applicationId: "app1", action: "md_accept", otp: "222222" });
  assertEquals(result, false);
});

Deno.test("verifyOtp - correct code against a valid unexpired row -> true", async () => {
  const hash = await sha256Hex("654321");
  const client = createFakeAdminClient(
    { empanelment_action_otps: [
      { data: { id: "row1", otp_hash: hash, expires_at: new Date(Date.now() + 60_000).toISOString() }, error: null },
      { data: null, error: null }, // the consumed_at update
    ] },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
  const result = await verifyOtp(client as never, { userId: "u1", applicationId: "app1", action: "md_accept", otp: "654321" });
  assertEquals(result, true);
});
