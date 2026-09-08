import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const LEAD_ID = "lead-1";
const PR_ID = "pr-1";
const REVIEWER_ID = "reviewer-1";
const AUTHORITY_ID = "authority-1";
const TEAM = "BPDD";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: TEAM, office: "delhi", committee: null, is_active: true, email: "caller@afc.com", ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, status: "pa_action_required", created_by: CALLER_ID, person_responsible_id: PR_ID,
    lead_number: "LH-2026-000001", documents: [], title: "Preparation of DPR for Smart City Project",
    portal_name: "GeM", bid_number: "BID-123", declined_from_status: "pmt_review", ...overrides,
  };
}

function baseFields(overrides: Record<string, string> = {}) {
  return {
    lead_id: LEAD_ID,
    title: "Preparation of DPR for Smart City Project (revised)",
    person_responsible_id: PR_ID,
    reviewer_id: REVIEWER_ID,
    approval_authority_id: AUTHORITY_ID,
    ...overrides,
  };
}

function formReq(fields: Record<string, string>, token = fakeJwt({ sub: CALLER_ID })): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("https://x.com/update-lead", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
}

function buildClient(opts: {
  caller?: Record<string, unknown>;
  lead?: Record<string, unknown> | null;
  personResponsible?: Record<string, unknown> | null;
  prTarget?: FakeResult;
  reviewerTarget?: FakeResult;
  authorityTarget?: FakeResult;
  updateResult?: FakeResult;
  routes?: Record<string, FakeResult[]>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [
    { data: opts.caller ?? callerRow(), error: null },
    { data: opts.personResponsible === undefined ? { id: PR_ID, team: TEAM, is_active: true } : opts.personResponsible, error: null },
    opts.prTarget ?? { data: { id: PR_ID, role: "project_officer", team: TEAM, committee: null, is_active: true }, error: null },
    opts.reviewerTarget ?? { data: { id: REVIEWER_ID, role: "associate_consultant", team: TEAM, committee: "PMT", is_active: true }, error: null },
    opts.authorityTarget ?? { data: { id: AUTHORITY_ID, role: "agm", team: TEAM, committee: "PMT Extended", is_active: true }, error: null },
    // Every afc_users call after the four above is notification fan-out
    // (getCommitteeMembers), which expects an array — the fake repeats its
    // last queued entry once exhausted, so keep it array-shaped.
    { data: [], error: null },
  ];
  routes.leads = [
    { data: opts.lead === undefined ? leadRow() : opts.lead, error: null },
    opts.updateResult ?? { data: {}, error: null },
  ];
  return createFakeAdminClient(routes);
}

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
  const res = await handleRequest(formReq(baseFields({ lead_id: "" })), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - unknown lead -> 404", async () => {
  const client = buildClient({ lead: null });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - rejects a caller who is neither creator nor Person Responsible", async () => {
  const client = buildClient({ lead: leadRow({ created_by: "someone-else", person_responsible_id: "someone-else-2" }) });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - rejects editing a lead that isn't pa_action_required", async () => {
  const client = buildClient({ lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - rejects a Reviewer on a different team", async () => {
  const client = buildClient({ reviewerTarget: { data: { id: REVIEWER_ID, role: "associate_consultant", team: "OtherTeam", committee: null, is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - rejects an Approval Authority who isn't AGM, SRM, or DGM", async () => {
  const client = buildClient({ authorityTarget: { data: { id: AUTHORITY_ID, role: "project_officer", team: TEAM, committee: "PMT Extended", is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - accepts an SRM Approval Authority (same permissions as AGM)", async () => {
  const client = buildClient({ authorityTarget: { data: { id: AUTHORITY_ID, role: "srm", team: TEAM, committee: null, is_active: true }, error: null } });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 200);
});

// A pa_action_required lead is a plain in-place edit, same as pa_review —
// saving never resubmits it into the approval pipeline (that's a separate,
// deliberate action via the Lead Approval Note's Accept flow). Checked
// against every decline source, since this used to route differently
// depending on which stage declined it.
for (const declinedFrom of ["dgm_initial_review", "pmt_review", "pmt_extended_review", "dgm_review", "md_review"]) {
  Deno.test(`handleRequest - editing a lead declined from ${declinedFrom} leaves it at pa_action_required, does not resubmit`, async () => {
    const client = buildClient({ lead: leadRow({ declined_from_status: declinedFrom }) });
    const res = await handleRequest(formReq(baseFields()), client as never);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    assertEquals(body.status, "pa_action_required");
  });
}

Deno.test("handleRequest - editing a pa_action_required lead only logs 'edited', never 'resubmitted'", async () => {
  const client = buildClient({});
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 200);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const activityInsertCalls = log.filter((entry) => entry.table === "lead_activity_log").flatMap((entry) => entry.calls.filter((c) => c[0] === "insert"));
  assertEquals(activityInsertCalls.length, 1);
  assertEquals(activityInsertCalls[0][1]?.includes('"edited"'), true);
  assertEquals(activityInsertCalls[0][1]?.includes("resubmitted"), false);
});

Deno.test("handleRequest - a resubmit_comment field, if sent, is simply ignored (no such feature anymore)", async () => {
  const client = buildClient({ lead: leadRow({ declined_from_status: "md_review" }) });
  const res = await handleRequest(formReq(baseFields({ resubmit_comment: "Fixed the budget line." })), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "pa_action_required");
});

Deno.test("handleRequest - title/portal_name/bid_number in the request body are ignored — server keeps the lead's existing values", async () => {
  const client = buildClient({});
  const res = await handleRequest(
    formReq(baseFields({ title: "Sneaky new title", portal_name: "Sneaky portal", bid_number: "Sneaky bid" })),
    client as never
  );
  assertEquals(res.status, 200);
  const updateCall = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log
    .find((entry) => entry.table === "leads" && entry.calls.some((c) => c[0] === "update"));
  const updatePayload = updateCall?.calls.find((c) => c[0] === "update")?.[1] ?? "";
  assertEquals(updatePayload.includes("Sneaky"), false);
});

Deno.test("handleRequest - a pa_review lead can be edited in place, status unchanged", async () => {
  const client = buildClient({ lead: leadRow({ status: "pa_review" }) });
  const res = await handleRequest(formReq(baseFields()), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.status, "pa_review");
});

Deno.test("handleRequest - the Person Responsible (not creator) can edit a pa_review lead", async () => {
  const client = buildClient({
    caller: callerRow({ id: PR_ID }),
    lead: leadRow({ status: "pa_review", created_by: "someone-else", person_responsible_id: PR_ID }),
  });
  const res = await handleRequest(formReq(baseFields(), fakeJwt({ sub: PR_ID })), client as never);
  assertEquals(res.status, 200);
});
