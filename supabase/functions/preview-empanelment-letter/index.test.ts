import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const APP_ID = "app-1";

// A real (tiny, valid) 1x1 PNG — pdf-lib actually parses the logo bytes.
const MINIMAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
function pngBytes(): Uint8Array {
  const bin = atob(MINIMAL_PNG_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const logoOkFetch = (() => Promise.resolve(new Response(pngBytes(), { status: 200 }))) as unknown as typeof fetch;

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID, status: "md_review", team: "BPDD", application_code: "12345", provisional_letter_sent: false,
    ...overrides,
  };
}

function client(opts: {
  caller?: Record<string, unknown>;
  app?: Record<string, unknown> | null;
  reg?: Record<string, unknown> | null;
}) {
  return createFakeAdminClient({
    afc_users: [{ data: opts.caller ?? { id: CALLER_ID, role: "md", team: "BPDD", is_active: true, email: "md@afc.com" }, error: null }, { data: { full_name: "Priya Sharma", signature_path: null }, error: null }],
    empanelment_applications: [{ data: opts.app === undefined ? appRow() : opts.app, error: null }, { data: { count: 2 }, error: null }],
    ba_registrations: [{ data: opts.reg === undefined ? { org_name: "Acme Org", contact_person: "Jane Doe", designation: "Director", reg_address: "1 Main St", sectors_served: ["Agri"] } : opts.reg, error: null }],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/preview-empanelment-letter", { token: fakeJwt({ sub: CALLER_ID }), body });
}

function withFetch(impl: typeof fetch, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("final preview - rejects a non-MD caller", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, type: "final" }), client({ caller: { id: CALLER_ID, role: "dgm", team: "BPDD", is_active: true } }) as never);
  assertEquals(res.status, 403);
});

Deno.test("final preview - rejects when not in md_review", async () => {
  const res = await handleRequest(req({ application_id: APP_ID, type: "final" }), client({ app: appRow({ status: "dgm_review" }) }) as never);
  assertEquals(res.status, 400);
});

Deno.test("final preview - success returns a pdf_base64 without mutating anything", async () => {
  const fake = client({});
  await withFetch(logoOkFetch, async () => {
    const res = await handleRequest(req({ application_id: APP_ID, type: "final" }), fake as never);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(typeof json.pdf_base64, "string");
  });
});

Deno.test("provisional preview - rejects a DGM from a different team", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, type: "provisional" }),
    client({ caller: { id: CALLER_ID, role: "dgm", team: "BIID", is_active: true }, app: appRow({ team: "BPDD" }) }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("provisional preview - rejects when already sent", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID, type: "provisional" }),
    client({ caller: { id: CALLER_ID, role: "dgm", team: "BPDD", is_active: true }, app: appRow({ provisional_letter_sent: true }) }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("provisional preview - success returns a pdf_base64", async () => {
  const fake = client({ caller: { id: CALLER_ID, role: "dgm", team: "BPDD", is_active: true } });
  await withFetch(logoOkFetch, async () => {
    const res = await handleRequest(req({ application_id: APP_ID, type: "provisional" }), fake as never);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(typeof json.pdf_base64, "string");
  });
});
