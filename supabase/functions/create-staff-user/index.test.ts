import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const CALLER_ID = "caller-1";

function client(opts: {
  caller?: Record<string, unknown> | null;
  existing?: Record<string, unknown> | null;
  createUserResult?: { data: unknown; error: unknown };
  insertProfileError?: unknown;
}) {
  const caller = opts.caller === undefined ? { id: CALLER_ID, role: "admin", team: null, office: null, is_active: true } : opts.caller;
  return createFakeAdminClient(
    {
      afc_users: [{ data: caller, error: null }, { data: opts.existing ?? null, error: null }],
      application_audit_log: [{ data: null, error: null }],
      notifications: [{ data: null, error: null }],
    },
    { auth: { createUser: opts.createUserResult ?? { data: { user: { id: "new-user-1" } }, error: null } } },
  );
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/create-staff-user", { token: fakeJwt({ sub: CALLER_ID }), body });
}

const okFetch = (() => Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }))) as unknown as typeof fetch;

Deno.test("create-staff-user - rejects an unauthenticated caller", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), client({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("create-staff-user - rejects a deactivated caller", async () => {
  const res = await handleRequest(
    req({ email: "new@afc.com", full_name: "New Person", role: "cfo" }),
    client({ caller: { id: CALLER_ID, role: "admin", is_active: false } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("create-staff-user - rejects a role Admin isn't allowed to create (e.g. md)", async () => {
  const res = await handleRequest(req({ email: "new@afc.com", full_name: "New Person", role: "md" }), client({}) as never);
  assertEquals(res.status, 403);
});

Deno.test("create-staff-user - rejects a role Admin isn't allowed to create (e.g. admin, to prevent silent self-replication)", async () => {
  const res = await handleRequest(req({ email: "new@afc.com", full_name: "New Person", role: "admin" }), client({}) as never);
  assertEquals(res.status, 403);
});

Deno.test("create-staff-user - MD's bootstrap allowance is limited to creating admin accounts only", async () => {
  const res = await handleRequest(
    req({ email: "new@afc.com", full_name: "New Person", role: "cfo" }),
    client({ caller: { id: CALLER_ID, role: "md", is_active: true } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("create-staff-user - MD can create the first admin account", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const res = await handleRequest(
      req({ email: "new-admin@afc.com", full_name: "New Admin", role: "admin" }),
      client({ caller: { id: CALLER_ID, role: "md", is_active: true } }) as never,
    );
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("create-staff-user - rejects an invalid email", async () => {
  const res = await handleRequest(req({ email: "not-an-email", full_name: "New Person", role: "cfo" }), client({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("create-staff-user - rejects a too-short full name", async () => {
  const res = await handleRequest(req({ email: "new@afc.com", full_name: "A", role: "cfo" }), client({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("create-staff-user - rejects a duplicate email", async () => {
  const res = await handleRequest(
    req({ email: "existing@afc.com", full_name: "New Person", role: "cfo" }),
    client({ existing: { id: "already-exists" } }) as never,
  );
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "An account with this email already exists.");
});

Deno.test("create-staff-user - success path returns email_sent true and never echoes the password", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const res = await handleRequest(req({ email: "new@afc.com", full_name: "New Person", role: "cfo" }), client({}) as never);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json, { success: true, email_sent: true });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("create-staff-user - returns the temp password only when the credentials email fails to send", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("down", { status: 500 }))) as unknown as typeof fetch;
  try {
    const res = await handleRequest(req({ email: "new@afc.com", full_name: "New Person", role: "cfo" }), client({}) as never);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.email_sent, false);
    assertEquals(typeof json.password, "string");
  } finally {
    globalThis.fetch = original;
  }
});
