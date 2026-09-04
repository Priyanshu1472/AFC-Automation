import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const CALLER_ID = "dgm-1";
const APP_ID = "app-1";

// A real (tiny, valid) 1x1 PNG — needed because pdf-lib actually parses the
// logo bytes; garbage bytes make embedPng/embedJpg both throw.
const MINIMAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
function pngBytes(): Uint8Array {
  const bin = atob(MINIMAL_PNG_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID, status: "filled", ba_email: "ba@org.com", team: "BPDD",
    sent_by: "sender-1", application_code: "12345", provisional_letter_sent: false,
    ...overrides,
  };
}

function otpRoute(valid: boolean) {
  if (!valid) return [{ data: null, error: null }];
  return [{ data: { id: "row1", otp_hash: "will-be-overridden", expires_at: new Date(Date.now() + 60_000).toISOString() }, error: null }, { data: null, error: null }];
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function client(opts: {
  caller?: Record<string, unknown>;
  app?: Record<string, unknown> | null;
  otpHash?: string;
  reg?: Record<string, unknown> | null;
}) {
  const otpRow = opts.otpHash
    ? [{ data: { id: "row1", otp_hash: opts.otpHash, expires_at: new Date(Date.now() + 60_000).toISOString() }, error: null }, { data: null, error: null }]
    : [{ data: null, error: null }];
  return createFakeAdminClient(
    {
      afc_users: [{ data: opts.caller ?? { id: CALLER_ID, role: "dgm", team: "BPDD", is_active: true, email: "dgm@afc.com" }, error: null }, { data: { full_name: "Priya Sharma" }, error: null }],
      empanelment_applications: [{ data: opts.app === undefined ? appRow() : opts.app, error: null }, { data: { count: 2 }, error: null }, { data: null, error: null }],
      empanelment_action_otps: otpRow,
      ba_registrations: [{ data: opts.reg === undefined ? { org_name: "Acme Org", contact_person: "Jane Doe", designation: "Director", reg_address: "1 Main St" } : opts.reg, error: null }],
    },
    { rpc: { check_rate_limit: { data: [{ allowed: true, wait_seconds: 0 }], error: null } } },
  );
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/send-provisional-letter", { token: fakeJwt({ sub: CALLER_ID }), body });
}

Deno.test("send-provisional-letter - rejects a non-DGM caller", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, otp: "123456" }), client({ caller: { id: CALLER_ID, role: "md", is_active: true } }) as never);
  assertEquals(res.status, 403);
});

Deno.test("send-provisional-letter - rejects a DGM from a different team", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, otp: "123456" }),
    client({ caller: { id: CALLER_ID, role: "dgm", team: "BIID", is_active: true }, app: appRow({ team: "BPDD" }) }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("send-provisional-letter - rejects before the BA has submitted the form", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, otp: "123456" }), client({ app: appRow({ status: "sent" }) }) as never);
  assertEquals(res.status, 400);
});

Deno.test("send-provisional-letter - rejects when already sent", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, otp: "123456" }), client({ app: appRow({ provisional_letter_sent: true }) }) as never);
  assertEquals(res.status, 400);
});

Deno.test("send-provisional-letter - invalid OTP is rejected", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, otp: "000000" }), client({}) as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Invalid or expired verification code. Please request a new one.");
});

Deno.test("send-provisional-letter - valid OTP + valid logo produces a PDF and marks the letter sent", async () => {
  const hash = await sha256Hex("456789");
  const fake = client({ otpHash: hash });
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    return Promise.resolve(new Response(pngBytes(), { status: 200 }));
  }) as unknown as typeof fetch;
  try {
    const res = await handleRequest(req({ application_id: APP_ID, otp: "456789" }), fake as never);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(typeof json.ref, "string");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("send-provisional-letter - logo fetch failure surfaces a clean 500, not a stack trace", async () => {
  const hash = await sha256Hex("456789");
  const fake = client({ otpHash: hash });
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("not found", { status: 404 }))) as unknown as typeof fetch;
  try {
    const res = await handleRequest(req({ application_id: APP_ID, otp: "456789" }), fake as never);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, "Could not load logo. Please try again.");
  } finally {
    globalThis.fetch = original;
  }
});
