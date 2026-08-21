import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const LEAD_ID = "lead-1";
const TEAM = "BPDD";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: TEAM, office: "delhi", committee: null, is_active: true, email: "caller@afc.com", pin_hash: null, ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, status: "pa_review", created_by: CALLER_ID, person_responsible_id: CALLER_ID, ...overrides,
  };
}

function buildClient(opts: {
  caller?: Record<string, unknown>;
  lead?: Record<string, unknown> | null;
  routes?: Record<string, FakeResult[]>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [{ data: opts.caller ?? callerRow(), error: null }, ...(routes.afc_users || [])];
  routes.leads = [{ data: opts.lead === undefined ? leadRow() : opts.lead, error: null }, ...(routes.leads || [])];
  return createFakeAdminClient(routes);
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/generate-lead-approval-note", { token: fakeJwt({ sub: CALLER_ID }), body });
}

function withFetch(impl: typeof fetch, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// A genuine, minimal 1x1 PNG — needed so pdf-lib's embedPng actually
// succeeds in the one full end-to-end success test below.
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const logoOkFetch = (() => {
  const bytes = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));
  return Promise.resolve(new Response(bytes, { status: 200 }));
}) as unknown as typeof fetch;
const logoFailsFetch = (() => Promise.resolve(new Response("not found", { status: 404 }))) as unknown as typeof fetch;

Deno.test("handleRequest - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("handleRequest - missing lead_id -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - unknown lead -> 404", async () => {
  const client = buildClient({ lead: null });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - rejects a caller who is neither creator nor Person Responsible", async () => {
  const client = buildClient({ lead: leadRow({ created_by: "someone-else", person_responsible_id: "someone-else-2" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - rejects a lead that isn't pa_review or pa_action_required", async () => {
  const client = buildClient({ lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - the Person Responsible (not creator) can generate the note", async () => {
  const client = buildClient({ lead: leadRow({ created_by: "someone-else", person_responsible_id: CALLER_ID }) });
  await withFetch(logoFailsFetch, async () => {
    const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
    // Logo fetch fails in this test (no network access needed) -> the note
    // build fails gracefully with a 500, but this still proves the
    // permission check passed (a 403 would mean it never got this far).
    assertEquals(res.status, 500);
  });
});

Deno.test("handleRequest - surfaces a clean error when the letterhead logo can't be loaded", async () => {
  const client = buildClient({});
  await withFetch(logoFailsFetch, async () => {
    const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, "Could not load the AFC letterhead logo.");
  });
});

Deno.test("handleRequest - full success: saves approval_note_data, generates and stores the PDF", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null }, // getCallerProfile
      { data: { full_name: "Priya Sharma", role: "project_officer" }, error: null }, // Person Responsible lookup
    ],
    leads: [
      { data: leadRow(), error: null }, // initial auth/status check
      { data: {}, error: null }, // approval_note_data update
      { // regenerateApprovalNote's own fresh fetch
        data: {
          id: LEAD_ID, lead_number: "AFC/Lead/2026/001", title: "Test Lead", client_name: "A Client",
          submission_deadline: null, assigned_ba_id: null, person_responsible_id: CALLER_ID, team: TEAM,
          documents: [], approval_note_data: { nature_of_lead: "Nomination" },
        },
        error: null,
      },
      { data: {}, error: null }, // documents write-back
    ],
    lead_activity_log: [{ data: [], error: null }],
  });

  await withFetch(logoOkFetch, async () => {
    const res = await handleRequest(
      req({ lead_id: LEAD_ID, nature_of_lead: "Nomination", objectives: "Grow rural livelihoods.", scope_of_work: ["Step one", "Step two"] }),
      client as never
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    assertEquals(body.document.category, "approval_note");
    assertEquals(body.document.name, "Lead Approval Note.pdf");
  });
});
