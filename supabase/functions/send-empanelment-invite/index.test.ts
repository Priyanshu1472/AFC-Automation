import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

Deno.env.set("RESEND_API_KEY", "test-key");

const CALLER_ID = "caller-1";
const PO_ID = "po-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "associate_consultant", team: "BPDD", office: "delhi", is_active: true, email: "ac@afc.com", ...overrides };
}

function client(opts: {
  caller?: Record<string, unknown>;
  po?: Record<string, unknown> | null;
  dgm?: Record<string, unknown> | null;
  existing?: Record<string, unknown> | null;
  insertResult?: { data: unknown; error: unknown };
  teams?: string[];
}) {
  return createFakeAdminClient({
    afc_users: [{ data: opts.caller ?? callerRow(), error: null }, { data: opts.po === undefined ? { id: PO_ID, full_name: "PO Person", email: "po@afc.com" } : opts.po, error: null }, { data: opts.dgm === undefined ? { id: "dgm-1", full_name: "DGM Person" } : opts.dgm, error: null }],
    ...(opts.teams ? { afc_user_teams: [{ data: opts.teams.map((t) => ({ team: t })), error: null }] } : {}),
    empanelment_applications: [{ data: opts.existing ?? null, error: null }, opts.insertResult ?? { data: { id: "app-new-1" }, error: null }],
    empanelment_activity_log: [{ data: null, error: null }],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/send-empanelment-invite", { token: fakeJwt({ sub: CALLER_ID }), body });
}

const okFetch = (() => Promise.resolve(new Response(JSON.stringify({ id: "e1" }), { status: 200 }))) as unknown as typeof fetch;

Deno.test("send-empanelment-invite - rejects a role that can't send invites (e.g. project_officer)", async () => {
  const res = await handleRequest(
    req({ ba_email: "ba@org.com", project_officer_id: PO_ID }),
    client({ caller: callerRow({ role: "project_officer" }) }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("send-empanelment-invite - project_assistant has the same send permission as associate_consultant", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const res = await handleRequest(
      req({ ba_email: "ba@org.com", project_officer_id: PO_ID }),
      client({ caller: callerRow({ role: "project_assistant" }) }) as never,
    );
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("send-empanelment-invite - rejects a caller with no team assigned", async () => {
  const res = await handleRequest(
    req({ ba_email: "ba@org.com", project_officer_id: PO_ID }),
    client({ caller: callerRow({ team: null }) }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("send-empanelment-invite - rejects an invalid BP email", async () => {
  const res = await handleRequest(req({ ba_email: "not-an-email", project_officer_id: PO_ID }), client({}) as never);
  assertEquals(res.status, 400);
});

Deno.test("send-empanelment-invite - rejects a project officer not on the caller's team", async () => {
  const res = await handleRequest(req({ ba_email: "ba@org.com", project_officer_id: PO_ID }), client({ po: null }) as never);
  assertEquals(res.status, 400);
});

Deno.test("send-empanelment-invite - rejects a duplicate active invitation for the same BP email", async () => {
  const res = await handleRequest(
    req({ ba_email: "ba@org.com", project_officer_id: PO_ID }),
    client({ existing: { id: "existing-app", status: "po_review", application_code: "54321" } }) as never,
  );
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "This email already has an active invitation (Code: 54321, Status: po_review).");
});

Deno.test("send-empanelment-invite - succeeds even when the team has no DGM assigned yet", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const res = await handleRequest(req({ ba_email: "ba@org.com", project_officer_id: PO_ID }), client({ dgm: null }) as never);
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("send-empanelment-invite - accepts an AGM as the advising authority", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const res = await handleRequest(
      req({ ba_email: "ba@org.com", project_officer_id: PO_ID, advisor_id: "agm-1" }),
      client({ dgm: { id: "agm-1", full_name: "AGM Person", role: "agm" } }) as never,
    );
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("send-empanelment-invite - rejects an advisor_id that isn't an active DGM or AGM on the team", async () => {
  const res = await handleRequest(
    req({ ba_email: "ba@org.com", project_officer_id: PO_ID, advisor_id: "not-a-real-advisor" }),
    client({ dgm: null }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("send-empanelment-invite - a multi-team caller can target a non-primary assigned team via `team`", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const res = await handleRequest(
      req({ ba_email: "ba@org.com", project_officer_id: PO_ID, team: "HO" }),
      client({ caller: callerRow({ team: "BPDD" }), teams: ["BPDD", "HO"] }) as never,
    );
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("send-empanelment-invite - rejects a `team` the caller isn't assigned to", async () => {
  const res = await handleRequest(
    req({ ba_email: "ba@org.com", project_officer_id: PO_ID, team: "SomeOtherTeam" }),
    client({ caller: callerRow({ team: "BPDD" }) }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("send-empanelment-invite - accepts a Project Assistant reviewer when the team has no active Project Officer", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const adminClient = createFakeAdminClient({
      afc_users: [
        { data: callerRow(), error: null },
        { data: { id: PO_ID, full_name: "PA Person", email: "pa@afc.com", role: "project_assistant" }, error: null },
        { data: null, error: null, count: 0 },
        { data: { id: "dgm-1", full_name: "DGM Person" }, error: null },
      ],
      empanelment_applications: [{ data: null, error: null }, { data: { id: "app-new-1" }, error: null }],
      empanelment_activity_log: [{ data: null, error: null }],
    });
    const res = await handleRequest(req({ ba_email: "ba@org.com", project_officer_id: PO_ID }), adminClient as never);
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("send-empanelment-invite - rejects a Project Assistant reviewer when the team still has an active Project Officer", async () => {
  const adminClient = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null },
      { data: { id: PO_ID, full_name: "PA Person", email: "pa@afc.com", role: "project_assistant" }, error: null },
      { data: null, error: null, count: 1 },
    ],
    empanelment_applications: [{ data: null, error: null }],
    empanelment_activity_log: [{ data: null, error: null }],
  });
  const res = await handleRequest(req({ ba_email: "ba@org.com", project_officer_id: PO_ID }), adminClient as never);
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "Your team has an active Project Officer — select them instead of a Project Assistant.");
});

Deno.test("send-empanelment-invite - success returns the new application_id and email_sent status", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    const res = await handleRequest(req({ ba_email: "ba@org.com", project_officer_id: PO_ID }), client({}) as never);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json, { success: true, email_sent: true, application_id: "app-new-1" });
  } finally {
    globalThis.fetch = original;
  }
});
