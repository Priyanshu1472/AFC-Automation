import { assertEquals } from "jsr:@std/assert@1";
import { getCorsHeaders, isAllowedOrigin, jsonRes } from "./cors.ts";

// NETLIFY_SITE_SUFFIX / ALLOWED_ORIGIN are read once at module import time,
// so these tests exercise the default (both unset) configuration — the
// realistic state for a fresh test run.

Deno.test("isAllowedOrigin - empty origin is rejected (fail closed)", () => {
  assertEquals(isAllowedOrigin(""), false);
});

Deno.test("isAllowedOrigin - localhost on any port is allowed", () => {
  assertEquals(isAllowedOrigin("http://localhost:5173"), true);
  assertEquals(isAllowedOrigin("http://localhost:5174"), true);
});

Deno.test("isAllowedOrigin - 127.0.0.1 is allowed", () => {
  assertEquals(isAllowedOrigin("http://127.0.0.1:5173"), true);
});

Deno.test("isAllowedOrigin - unrelated origin rejected when no extra origin/suffix configured", () => {
  assertEquals(isAllowedOrigin("https://evil.example.com"), false);
});

Deno.test("isAllowedOrigin - malformed origin string doesn't throw", () => {
  assertEquals(isAllowedOrigin("not a url"), false);
});

Deno.test("getCorsHeaders - falls back to localhost default when origin isn't allowed", () => {
  const req = new Request("https://x.com", { headers: { origin: "https://evil.example.com" } });
  const headers = getCorsHeaders(req);
  assertEquals(headers["Access-Control-Allow-Origin"], "http://localhost:5173");
});

Deno.test("getCorsHeaders - echoes back an allowed origin", () => {
  const req = new Request("https://x.com", { headers: { origin: "http://localhost:5173" } });
  const headers = getCorsHeaders(req);
  assertEquals(headers["Access-Control-Allow-Origin"], "http://localhost:5173");
});

Deno.test("getCorsHeaders - default methods include POST, OPTIONS", () => {
  const req = new Request("https://x.com");
  const headers = getCorsHeaders(req);
  assertEquals(headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
});

Deno.test("jsonRes - sets status, JSON content-type, and CORS headers", async () => {
  const req = new Request("https://x.com", { headers: { origin: "http://localhost:5173" } });
  const res = jsonRes(req, 404, { error: "not found" });
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  assertEquals(await res.json(), { error: "not found" });
});
