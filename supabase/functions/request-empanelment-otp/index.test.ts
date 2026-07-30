import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const CALLER_ID = "caller-1";
const APP_ID = "app-1";
const ALLOWED_RATE = { data: [{ allowed: true, wait_seconds: 0 }], error: null };

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "md", team: "BPDD", office: "delhi", is_active: true, email: "md@afc.com", ...overrides };
}

function client(caller: Record<string, unknown>, app: Record<string, unknown> | null, otpInsertOk = true) {
  return createFakeAdminClient(
    {
      afc_users: [{ data: caller, error: null }],
      empanelment_applications: [{ data: app, error: null }],
      empanelment_action_otps: [{ data: null, error: null }, { data: null, error: otpInsertOk ? null : { message: "boom" } }],
    },
    { rpc: { check_rate_limit: ALLOWED_RATE } },
  );
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/request-empanelment-otp", { token: fakeJwt({ sub: CALLER_ID }), body });
}

function okFetch() {
  return Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
}

Deno.test("request-empanelment-otp - invalid action rejected", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, action: "made_up" }), client(callerRow(), { id: APP_ID, status: "md_review" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("request-empanelment-otp - missing application_id rejected", async () => {
  const res = await handleRequest(req({ action: "md_accept" }), client(callerRow(), null) as never);
  assertEquals(res.status, 400);
});

Deno.test("request-empanelment-otp - unknown application -> 404", async () => {
  const res = await handleRequest(req({ application_id: "nope", action: "md_accept" }), client(callerRow(), null) as never);
  assertEquals(res.status, 404);
});

Deno.test("request-empanelment-otp - md_accept rejects a non-MD caller", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, action: "md_accept" }),
    client(callerRow({ role: "dgm" }), { id: APP_ID, status: "md_review" }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("request-empanelment-otp - md_accept rejects wrong application status", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, action: "md_accept" }),
    client(callerRow(), { id: APP_ID, status: "dgm_review" }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("request-empanelment-otp - md_accept succeeds for the MD on an md_review application", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch as typeof fetch;
  try {
    const res = await handleRequest(
      req({ application_id: APP_ID, action: "md_accept" }),
      client(callerRow(), { id: APP_ID, status: "md_review" }) as never,
    );
    assertEquals(res.status, 200);
    assertEquals((await res.json()).sent_to, "md@afc.com");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("request-empanelment-otp - provisional_letter rejects a non-DGM caller", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, action: "provisional_letter" }),
    client(callerRow({ role: "md" }), { id: APP_ID, status: "filled", team: "BPDD", provisional_letter_sent: false }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("request-empanelment-otp - provisional_letter rejects a DGM from a different team", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, action: "provisional_letter" }),
    client(callerRow({ role: "dgm", team: "CBBO" }), { id: APP_ID, status: "filled", team: "BPDD", provisional_letter_sent: false }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("request-empanelment-otp - provisional_letter rejects when the BA hasn't submitted the form yet", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, action: "provisional_letter" }),
    client(callerRow({ role: "dgm" }), { id: APP_ID, status: "sent", team: "BPDD", provisional_letter_sent: false }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("request-empanelment-otp - provisional_letter rejects when already sent", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, action: "provisional_letter" }),
    client(callerRow({ role: "dgm" }), { id: APP_ID, status: "filled", team: "BPDD", provisional_letter_sent: true }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("request-empanelment-otp - provisional_letter succeeds for the team's DGM", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch as typeof fetch;
  try {
    const res = await handleRequest(
      req({ application_id: APP_ID, action: "provisional_letter" }),
      client(callerRow({ role: "dgm", email: "dgm@afc.com" }), { id: APP_ID, status: "filled", team: "BPDD", provisional_letter_sent: false }) as never,
    );
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("request-empanelment-otp - propagates issueOtp's rate-limit rejection as 429", async () => {
  const rateLimited = createFakeAdminClient(
    {
      afc_users: [{ data: callerRow(), error: null }],
      empanelment_applications: [{ data: { id: APP_ID, status: "md_review" }, error: null }],
    },
    { rpc: { check_rate_limit: { data: [{ allowed: false, wait_seconds: 300 }], error: null } } },
  );
  const res = await handleRequest(req({ application_id: APP_ID, action: "md_accept" }), rateLimited as never);
  assertEquals(res.status, 429);
});
