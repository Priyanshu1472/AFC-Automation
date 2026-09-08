import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const LEAD_ID = "lead-1";
const TEAM = "BPDD";
const PATH = `${LEAD_ID}/123-file.pdf`;

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: TEAM, office: "delhi", committee: null, is_active: true, email: "caller@afc.com", ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, status: "pmt_review", team: TEAM, created_by: "creator-1", person_responsible_id: "pr-1",
    reviewer_id: "reviewer-1", approval_authority_id: "authority-1", handled_by_dgm_id: null, assigned_ba_id: null,
    ...overrides,
  };
}

function buildClient(opts: {
  caller?: Record<string, unknown>;
  lead?: Record<string, unknown> | null;
  routes?: Record<string, FakeResult[]>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [{ data: opts.caller ?? callerRow(), error: null }];
  routes.leads = [{ data: opts.lead === undefined ? leadRow() : opts.lead, error: null }];
  return createFakeAdminClient(routes);
}

function req(body: Record<string, unknown>, token = fakeJwt({ sub: CALLER_ID })) {
  return authedReq("https://x.com/get-lead-document-url", { token, body });
}

Deno.test("handleRequest - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("handleRequest - rejects a path not prefixed with the lead's id", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: "some-other-lead/file.pdf" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - unknown lead -> 404", async () => {
  const client = buildClient({ lead: null });
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: PATH }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - a user with no relationship to the lead and no team match is forbidden", async () => {
  const client = buildClient({ caller: callerRow({ team: "SomeOtherTeam" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: PATH }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - a same-team user is authorized", async () => {
  const client = buildClient({ caller: callerRow({ team: TEAM }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: PATH }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - an AGM on the same team is NOT authorized unless named on the lead", async () => {
  const client = buildClient({ caller: callerRow({ role: "agm", team: TEAM }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: PATH }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - an AGM named as Approval Authority is authorized", async () => {
  const client = buildClient({ caller: callerRow({ role: "agm", id: "authority-1", team: TEAM }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: PATH }, fakeJwt({ sub: "authority-1" })), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - CFO/CS have org-wide access even off-team", async () => {
  const client = buildClient({ caller: callerRow({ role: "cfo", team: "SomeOtherTeam" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: PATH }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - a PMT committee member is authorized while the lead is at pmt_review, off-team", async () => {
  const client = buildClient({ caller: callerRow({ team: "SomeOtherTeam", committee: "PMT" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: PATH }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - a G3 (DGM committee) member from a different team is authorized once the lead is in dgm_review", async () => {
  const client = buildClient({
    caller: callerRow({ team: "SomeOtherTeam", committee: "G3" }),
    lead: leadRow({ status: "dgm_review", team: TEAM }),
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: PATH }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - success returns a signed url", async () => {
  const client = buildClient({ caller: callerRow({ role: "md", team: "OtherTeam" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID, path: PATH }), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(typeof body.url, "string");
});
