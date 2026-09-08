import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";

const CALLER_ID = "admin-1";
const TARGET_ID = "user-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "admin", team: null, office: "delhi", committee: null, is_active: true, email: "admin@afc.com", pin_hash: null, ...overrides };
}

function targetRow(overrides: Record<string, unknown> = {}) {
  return { id: TARGET_ID, full_name: "Priya Sharma", email: "priya@afc.com", signature_path: null, ...overrides };
}

function buildClient(opts: {
  caller?: Record<string, unknown>;
  target?: Record<string, unknown> | null;
  routes?: Record<string, FakeResult[]>;
  storage?: { upload?: FakeResult; remove?: FakeResult };
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [
    { data: opts.caller ?? callerRow(), error: null },
    { data: opts.target === undefined ? targetRow() : opts.target, error: null },
  ];
  return createFakeAdminClient(routes, { storage: opts.storage });
}

// A genuine 1x1 PNG so magic-byte validation passes.
const PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0)
);

function formReq(fields: { user_id?: string; file?: File }, token = fakeJwt({ sub: CALLER_ID })): Request {
  const fd = new FormData();
  if (fields.user_id !== undefined) fd.set("user_id", fields.user_id);
  if (fields.file !== undefined) fd.set("file", fields.file, fields.file.name);
  return new Request("https://x.com/upload-user-signature", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
}

function pngFile(name = "sig.png") {
  return new File([PNG_BYTES], name, { type: "image/png" });
}

Deno.test("handleRequest - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - non-admin caller -> 403", async () => {
  const client = buildClient({ caller: callerRow({ role: "dgm" }) });
  const res = await handleRequest(formReq({ user_id: TARGET_ID, file: pngFile() }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - missing user_id -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq({ file: pngFile() }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - missing file -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq({ user_id: TARGET_ID }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - wrong magic bytes -> 400", async () => {
  const client = buildClient({});
  const badFile = new File([new Uint8Array([1, 2, 3, 4])], "fake.png", { type: "image/png" });
  const res = await handleRequest(formReq({ user_id: TARGET_ID, file: badFile }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - oversized file -> 400", async () => {
  const client = buildClient({});
  const big = new Uint8Array(2 * 1024 * 1024 + 1);
  big.set(PNG_BYTES);
  const res = await handleRequest(formReq({ user_id: TARGET_ID, file: new File([big], "big.png", { type: "image/png" }) }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - unknown target user -> 404", async () => {
  const client = buildClient({ target: null });
  const res = await handleRequest(formReq({ user_id: TARGET_ID, file: pngFile() }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - success uploads and saves signature_path", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq({ user_id: TARGET_ID, file: pngFile() }), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
});

Deno.test("handleRequest - replacing an existing signature removes the old object", async () => {
  const client = buildClient({ target: targetRow({ signature_path: `${TARGET_ID}/old.png` }) });
  const res = await handleRequest(formReq({ user_id: TARGET_ID, file: pngFile() }), client as never);
  assertEquals(res.status, 200);
});
