import { assertEquals } from "jsr:@std/assert@1";
import { checkAnonKey, checkRateLimit, clearRateLimit, getClientIP } from "./publicAccess.ts";
import { createFakeAdminClient } from "./testHelpers.ts";

Deno.test("checkAnonKey - accepts matching apikey header", () => {
  Deno.env.set("SUPABASE_ANON_KEY", "anon-secret");
  const req = new Request("https://x.com", { headers: { apikey: "anon-secret" } });
  assertEquals(checkAnonKey(req), true);
});

Deno.test("checkAnonKey - accepts matching Bearer authorization header", () => {
  Deno.env.set("SUPABASE_ANON_KEY", "anon-secret");
  const req = new Request("https://x.com", { headers: { authorization: "Bearer anon-secret" } });
  assertEquals(checkAnonKey(req), true);
});

Deno.test("checkAnonKey - rejects wrong key", () => {
  Deno.env.set("SUPABASE_ANON_KEY", "anon-secret");
  const req = new Request("https://x.com", { headers: { apikey: "wrong" } });
  assertEquals(checkAnonKey(req), false);
});

Deno.test("checkAnonKey - rejects when no key provided", () => {
  Deno.env.set("SUPABASE_ANON_KEY", "anon-secret");
  const req = new Request("https://x.com");
  assertEquals(checkAnonKey(req), false);
});

Deno.test("checkAnonKey - rejects when SUPABASE_ANON_KEY isn't configured, even with a header", () => {
  Deno.env.delete("SUPABASE_ANON_KEY");
  const req = new Request("https://x.com", { headers: { apikey: "anything" } });
  assertEquals(checkAnonKey(req), false);
});

Deno.test("getClientIP - reads first IP from x-forwarded-for", () => {
  const req = new Request("https://x.com", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
  assertEquals(getClientIP(req), "1.2.3.4");
});

Deno.test("getClientIP - falls back to x-real-ip", () => {
  const req = new Request("https://x.com", { headers: { "x-real-ip": "9.9.9.9" } });
  assertEquals(getClientIP(req), "9.9.9.9");
});

Deno.test("getClientIP - falls back to 'unknown' with no IP headers", () => {
  const req = new Request("https://x.com");
  assertEquals(getClientIP(req), "unknown");
});

Deno.test("checkRateLimit - allowed when RPC reports allowed", async () => {
  const client = createFakeAdminClient({}, { rpc: { check_rate_limit: { data: [{ allowed: true, wait_seconds: 0 }], error: null } } });
  const result = await checkRateLimit(client as never, "ba-form:1.2.3.4");
  assertEquals(result, { allowed: true, waitMinutes: 0 });
});

Deno.test("checkRateLimit - blocked reports wait time rounded up to minutes", async () => {
  const client = createFakeAdminClient({}, { rpc: { check_rate_limit: { data: [{ allowed: false, wait_seconds: 90 }], error: null } } });
  const result = await checkRateLimit(client as never, "ba-form:1.2.3.4");
  assertEquals(result, { allowed: false, waitMinutes: 2 });
});

Deno.test("checkRateLimit - fails open (allowed) when the RPC errors, so a DB hiccup doesn't take down the public form", async () => {
  const client = createFakeAdminClient({}, { rpc: { check_rate_limit: { data: null, error: { message: "db down" } } } });
  const result = await checkRateLimit(client as never, "ba-form:1.2.3.4");
  assertEquals(result, { allowed: true, waitMinutes: 0 });
});

Deno.test("clearRateLimit - deletes the rate_limit_attempts row for the key without throwing", async () => {
  const client = createFakeAdminClient({ rate_limit_attempts: [{ data: null, error: null }] });
  await clearRateLimit(client as never, "ba-form:1.2.3.4");
  const call = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log[0];
  assertEquals(call.table, "rate_limit_attempts");
  assertEquals(call.calls[0][0], "delete");
});
