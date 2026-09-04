import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";

const CALLER_ID = "admin-1";
const TARGET_ID = "user-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "admin", team: null, office: "delhi", committee: null, is_active: true, email: "admin@afc.com", pin_hash: null, ...overrides };
}

function buildClient(opts: {
  caller?: Record<string, unknown>;
  target?: Record<string, unknown> | null;
  routes?: Record<string, FakeResult[]>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [
    { data: opts.caller ?? callerRow(), error: null },
    { data: opts.target === undefined ? { id: TARGET_ID, signature_path: `${TARGET_ID}/sig.png` } : opts.target, error: null },
  ];
  return createFakeAdminClient(routes);
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/get-user-signature-url", { token: fakeJwt({ sub: CALLER_ID }), body });
}

Deno.test("handleRequest - non-admin caller requesting someone else's signature -> 403", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm" }) });
  const res = await handleRequest(req({ user_id: TARGET_ID }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - non-admin caller can view their own signature", async () => {
  const client = buildClient({
    caller: callerRow({ id: TARGET_ID, role: "dgm" }),
    target: { id: TARGET_ID, signature_path: `${TARGET_ID}/sig.png` },
  });
  const res = await handleRequest(req({ user_id: TARGET_ID }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - missing user_id -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - unknown user -> 404", async () => {
  const client = buildClient({ target: null });
  const res = await handleRequest(req({ user_id: TARGET_ID }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - user with no signature -> 404", async () => {
  const client = buildClient({ target: { id: TARGET_ID, signature_path: null } });
  const res = await handleRequest(req({ user_id: TARGET_ID }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - success signs a URL", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ user_id: TARGET_ID }), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(typeof body.url, "string");
});
