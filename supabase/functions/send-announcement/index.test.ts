import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "super_admin", team: null, office: null, is_active: true, email: "caller@afc.com", ...overrides };
}

function client(opts: { caller?: Record<string, unknown>; insertResult?: { data: unknown; error: unknown } } = {}) {
  return createFakeAdminClient({
    afc_users: [{ data: opts.caller ?? callerRow(), error: null }],
    org_announcements: [opts.insertResult ?? { data: null, error: null }],
  });
}

function req(body: Record<string, unknown> = {}) {
  return authedReq("https://x.com/send-announcement", { token: fakeJwt({ sub: CALLER_ID }), body: { items: ["Update one", "Update two"], ...body } });
}

Deno.test("send-announcement - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), client() as never);
  assertEquals(res.status, 401);
});

Deno.test("send-announcement - rejects a non-super_admin caller", async () => {
  const res = await handleRequest(req(), client({ caller: callerRow({ role: "admin" }) }) as never);
  assertEquals(res.status, 403);
});

Deno.test("send-announcement - empty items array -> 400", async () => {
  const res = await handleRequest(req({ items: [] }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("send-announcement - blank/whitespace-only items are dropped, and an all-blank list is rejected", async () => {
  const res = await handleRequest(req({ items: ["   ", ""] }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("send-announcement - success inserts a trimmed items array", async () => {
  const c = client({ caller: callerRow(), insertResult: { data: null, error: null } });
  const res = await handleRequest(req({ items: ["  Feature one  ", "Feature two"] }), c as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);

  const log = (c as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const insertCall = log.filter((l) => l.table === "org_announcements").flatMap((l) => l.calls).find((cc) => cc[0] === "insert");
  const inserted = JSON.parse(insertCall![1]);
  assertEquals(inserted.items, ["Feature one", "Feature two"]);
  assertEquals(inserted.created_by, CALLER_ID);
});
