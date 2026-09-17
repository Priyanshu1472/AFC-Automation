import { assertEquals } from "jsr:@std/assert@1";
import { verifyServiceToken } from "./serviceAuth.ts";

const SECRET = "unit-test-secret";
const AUDIENCE = "experience-import-gateway";
const CLIENT_ID = "experience-intelligence";

function base64Url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: Record<string, unknown>, secret = SECRET, alg = "HS256"): Promise<string> {
  const headerB64 = base64Url(JSON.stringify({ alg, typ: "JWT" }));
  const payloadB64 = base64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${signingInput}.${sigB64}`;
}

function reqWith(token?: string, clientIdHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (clientIdHeader) headers["x-client-id"] = clientIdHeader;
  return new Request("https://x.com", { headers });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { sub: CLIENT_ID, aud: AUDIENCE, iat: now, exp: now + 300, ...overrides };
}

Deno.test("verifyServiceToken - accepts a correctly signed, unexpired token", async () => {
  const token = await sign(validPayload());
  const result = await verifyServiceToken(reqWith(token, CLIENT_ID), SECRET, AUDIENCE, CLIENT_ID);
  assertEquals(result.ok, true);
});

Deno.test("verifyServiceToken - rejects a missing Authorization header", async () => {
  const result = await verifyServiceToken(reqWith(), SECRET, AUDIENCE, CLIENT_ID);
  assertEquals(result.ok, false);
  assertEquals((result as { status: number }).status, 401);
});

Deno.test("verifyServiceToken - rejects a token signed with a different secret", async () => {
  const token = await sign(validPayload(), "other-secret");
  const result = await verifyServiceToken(reqWith(token), SECRET, AUDIENCE, CLIENT_ID);
  assertEquals(result.ok, false);
});

Deno.test("verifyServiceToken - rejects a tampered payload (signature no longer matches)", async () => {
  const token = await sign(validPayload());
  const [h, p, s] = token.split(".");
  const tamperedPayload = base64Url(JSON.stringify(validPayload({ sub: "someone-else" })));
  const tampered = `${h}.${tamperedPayload}.${s}`;
  const result = await verifyServiceToken(reqWith(tampered), SECRET, AUDIENCE, CLIENT_ID);
  assertEquals(result.ok, false);
});

Deno.test("verifyServiceToken - rejects an expired token", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(validPayload({ exp: now - 60 }));
  const result = await verifyServiceToken(reqWith(token), SECRET, AUDIENCE, CLIENT_ID);
  assertEquals(result.ok, false);
});

Deno.test("verifyServiceToken - rejects wrong audience", async () => {
  const token = await sign(validPayload({ aud: "some-other-gateway" }));
  const result = await verifyServiceToken(reqWith(token), SECRET, AUDIENCE, CLIENT_ID);
  assertEquals(result.ok, false);
});

Deno.test("verifyServiceToken - rejects an unknown client id (sub)", async () => {
  const token = await sign(validPayload({ sub: "some-other-client" }));
  const result = await verifyServiceToken(reqWith(token), SECRET, AUDIENCE, CLIENT_ID);
  assertEquals(result.ok, false);
  assertEquals((result as { status: number }).status, 403);
});

Deno.test("verifyServiceToken - rejects a non-HS256 algorithm", async () => {
  const token = await sign(validPayload(), SECRET, "none");
  const result = await verifyServiceToken(reqWith(token), SECRET, AUDIENCE, CLIENT_ID);
  assertEquals(result.ok, false);
});

Deno.test("verifyServiceToken - rejects a mismatched x-client-id header", async () => {
  const token = await sign(validPayload());
  const result = await verifyServiceToken(reqWith(token, "someone-else"), SECRET, AUDIENCE, CLIENT_ID);
  assertEquals(result.ok, false);
  assertEquals((result as { status: number }).status, 403);
});
