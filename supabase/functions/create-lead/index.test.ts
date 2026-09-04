import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const PR_ID = "pr-1";
const REVIEWER_ID = "reviewer-1";
const AUTHORITY_ID = "authority-1";
const TEAM = "BPDD";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: TEAM, office: "delhi", committee: null, is_active: true, email: "caller@afc.com", ...overrides };
}

function baseFields(overrides: Record<string, string> = {}) {
  return {
    title: "Preparation of DPR for Smart City Project",
    person_responsible_id: PR_ID,
    reviewer_id: REVIEWER_ID,
    approval_authority_id: AUTHORITY_ID,
    ...overrides,
  };
}

function formReq(fields: Record<string, string>, token = fakeJwt({ sub: CALLER_ID })): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("https://x.com/create-lead", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
}

// afc_users is queried in a fixed order: caller (getCallerProfile), the
// Person Responsible's team lookup, then getTargetUser for Person
// Responsible/Reviewer/Approval Authority (validateAssignment/
// validateReviewer/validateApprovalAuthority) — see create-lead/index.ts.
function buildClient(opts: {
  caller?: Record<string, unknown>;
  personResponsible?: Record<string, unknown> | null;
  prTarget?: FakeResult;
  reviewerTarget?: FakeResult;
  authorityTarget?: FakeResult;
  baTarget?: FakeResult;
  routes?: Record<string, FakeResult[]>;
  rpc?: Record<string, FakeResult>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [
    { data: opts.caller ?? callerRow(), error: null },
    { data: opts.personResponsible === undefined ? { id: PR_ID, team: TEAM, is_active: true } : opts.personResponsible, error: null },
    opts.prTarget ?? { data: { id: PR_ID, role: "project_officer", team: TEAM, committee: null, is_active: true }, error: null },
    opts.reviewerTarget ?? { data: { id: REVIEWER_ID, role: "associate_consultant", team: TEAM, committee: "PMT", is_active: true }, error: null },
    opts.authorityTarget ?? { data: { id: AUTHORITY_ID, role: "agm", team: TEAM, committee: "PMT Extended", is_active: true }, error: null },
  ];
  if (opts.baTarget) routes.afc_users.push(opts.baTarget);
  routes.leads = routes.leads ?? [{ data: { id: "new-lead-1", lead_number: "LH-2026-000001", status: "pa_review" }, error: null }];
  return createFakeAdminClient(routes, { rpc: { next_lead_number: { data: "LH-2026-000001", error: null }, ...(opts.rpc || {}) } });
}

Deno.test("handleRequest - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), buildClient({}) as never);
  assertEquals(res.status, 405);
});

Deno.test("handleRequest - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("handleRequest - missing title -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq(baseFields({ title: "" })), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - eoi lead_type is accepted", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq(baseFields({ lead_type: "eoi" })), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - an invalid lead_type is rejected", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq(baseFields({ lead_type: "bogus" })), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - an invalid source is rejected", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq(baseFields({ source: "bogus" })), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - ba source without assigned_ba_id is rejected", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq(baseFields({ source: "ba" })), client as never);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Select a Business Associate for a BA Source lead.");
});

Deno.test("handleRequest - ba source with a valid assigned_ba_id succeeds", async () => {
  const BA_ID = "ba-1";
  const client = buildClient({ baTarget: { data: { id: BA_ID, role: "business_associate", team: TEAM, is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields({ source: "ba", assigned_ba_id: BA_ID })), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - suo_moto source without assigned_ba_id is rejected", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq(baseFields({ source: "suo_moto" })), client as never);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Select a Business Associate for a Suo Moto lead.");
});

Deno.test("handleRequest - suo_moto source with a valid assigned_ba_id succeeds and stores the Suo-Moto-only dates", async () => {
  const BA_ID = "ba-1";
  const client = buildClient({ baTarget: { data: { id: BA_ID, role: "business_associate", team: TEAM, is_active: true }, error: null } });
  const res = await handleRequest(
    formReq(baseFields({
      source: "suo_moto", assigned_ba_id: BA_ID,
      presentation_date: "2026-09-01", followup_date: "2026-09-15",
    })),
    client as never
  );
  assertEquals(res.status, 200);

  const leadsLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
  const insertCall = leadsLog[0].calls.find((c) => c[0] === "insert");
  const inserted = JSON.parse(insertCall![1]);
  assertEquals(inserted.source, "suo_moto");
  assertEquals(inserted.presentation_date, "2026-09-01");
  assertEquals(inserted.followup_date, "2026-09-15");
});

Deno.test("handleRequest - MD cannot create a lead directly", async () => {
  const client = buildClient({ caller: callerRow({ role: "md" }) });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - Admin cannot create a lead directly", async () => {
  const client = buildClient({ caller: callerRow({ role: "admin" }) });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - every non-md/non-admin role can create a lead", async () => {
  for (const role of ["project_assistant", "project_officer", "associate_consultant", "agm", "dgm", "cfo"]) {
    const client = buildClient({ caller: callerRow({ role }) });
    const res = await handleRequest(formReq(baseFields()), client as never);
    assertEquals(res.status, 200, `expected role "${role}" to be allowed to create a lead`);
  }
});

Deno.test("handleRequest - Person Responsible can be any staff role, as long as they're on the team", async () => {
  const client = buildClient({ prTarget: { data: { id: PR_ID, role: "cfo", team: TEAM, committee: null, is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - rejects a Person Responsible on a different team", async () => {
  const client = buildClient({ prTarget: { data: { id: PR_ID, role: "project_officer", team: "OtherTeam", committee: null, is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - rejects a Business Associate as Person Responsible", async () => {
  const client = buildClient({ prTarget: { data: { id: PR_ID, role: "business_associate", team: TEAM, committee: null, is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - Reviewer can be any staff role, as long as they're on the team", async () => {
  const client = buildClient({ reviewerTarget: { data: { id: REVIEWER_ID, role: "srm", team: TEAM, committee: null, is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - rejects a Reviewer on a different team", async () => {
  const client = buildClient({ reviewerTarget: { data: { id: REVIEWER_ID, role: "associate_consultant", team: "OtherTeam", committee: null, is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - rejects a Business Associate as Reviewer", async () => {
  const client = buildClient({ reviewerTarget: { data: { id: REVIEWER_ID, role: "business_associate", team: TEAM, committee: null, is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - rejects an Approval Authority who isn't AGM, SRM, or DGM", async () => {
  const client = buildClient({ authorityTarget: { data: { id: AUTHORITY_ID, role: "associate_consultant", team: TEAM, committee: "PMT Extended", is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - Approval Authority is valid as AGM, SRM, or DGM (SRM has the same permissions as AGM), committee irrelevant", async () => {
  for (const role of ["agm", "srm", "dgm"]) {
    const client = buildClient({ authorityTarget: { data: { id: AUTHORITY_ID, role, team: TEAM, committee: null, is_active: true }, error: null } });
    const res = await handleRequest(formReq(baseFields()), client as never);
    assertEquals(res.status, 200, `expected role "${role}" to be a valid Approval Authority`);
  }
});

Deno.test("handleRequest - rejects an inactive Person Responsible", async () => {
  const client = buildClient({ personResponsible: { id: PR_ID, team: TEAM, is_active: false } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - success creates the lead directly into pa_review", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.status, "pa_review");
  assertEquals(body.lead_number, "LH-2026-000001");
});
