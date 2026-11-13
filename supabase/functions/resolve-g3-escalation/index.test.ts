import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

const CALLER_ID = "md-1";
const ESCALATION_ID = "esc-1";
const ACCEPTED_ID = "lead-1";
const DROPPED_ID = "lead-2";

const CALLER_PIN = "5432";
const CALLER_PIN_HASH = await hashPin(CALLER_PIN, CALLER_ID);

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "md", team: null, office: "delhi", committee: null, is_active: true, email: "md@afc.com", pin_hash: CALLER_PIN_HASH, ...overrides };
}

function memberRows(overrides: { acceptedPreviousStatus?: string; droppedPreviousStatus?: string } = {}) {
  return [
    {
      lead_id: ACCEPTED_ID, previous_status: overrides.acceptedPreviousStatus ?? "pmt_review",
      leads: { id: ACCEPTED_ID, lead_number: "AFC/TEAM 1/L/26/001", title: "Primary Lead", created_by: "creator-1", person_responsible_id: "pr-1", reviewer_id: "rev-1", recommending_authority_id: "ra-1" },
    },
    {
      lead_id: DROPPED_ID, previous_status: overrides.droppedPreviousStatus ?? "pa_review",
      leads: { id: DROPPED_ID, lead_number: "AFC/TEAM 2/L/26/002", title: "Conflicting Lead", created_by: "creator-2", person_responsible_id: "pr-2", reviewer_id: "rev-2", recommending_authority_id: "pr-2" },
    },
  ];
}

// lead_g3_escalations is consumed twice: [0] the initial lookup, [1] the
// final resolve-update.
function buildClient(opts: {
  caller?: Record<string, unknown>;
  escalation?: Record<string, unknown>;
  escalationMissing?: boolean;
  members?: Record<string, unknown>[];
  routes?: Record<string, FakeResult[]>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [{ data: opts.caller ?? callerRow(), error: null }, ...(routes.afc_users || [])];
  routes.afc_user_teams = routes.afc_user_teams || [{ data: [], error: null }];
  routes.lead_g3_escalations = [
    { data: opts.escalationMissing ? null : opts.escalation ?? { id: ESCALATION_ID, status: "open" }, error: null },
    { data: null, error: null },
    ...(routes.lead_g3_escalations || []),
  ];
  routes.lead_g3_escalation_members = routes.lead_g3_escalation_members || [{ data: opts.members ?? memberRows(), error: null }];
  routes.leads = routes.leads || [{ data: { id: ACCEPTED_ID }, error: null }];
  routes.lead_activity_log = routes.lead_activity_log || [{ data: null, error: null }];
  routes.notifications = routes.notifications || [{ data: null, error: null }];
  return createFakeAdminClient(routes);
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/resolve-g3-escalation", {
    token: fakeJwt({ sub: CALLER_ID }),
    body: { escalation_id: ESCALATION_ID, accepted_lead_id: ACCEPTED_ID, pin: CALLER_PIN, ...body },
  });
}

Deno.test("handleRequest - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - non-MD caller -> 403", async () => {
  const client = buildClient({ caller: callerRow({ role: "project_officer" }) });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - missing ids -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ accepted_lead_id: "" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - unknown escalation -> 404", async () => {
  const client = buildClient({ escalationMissing: true });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - escalation already resolved -> 400", async () => {
  const client = buildClient({ escalation: { id: ESCALATION_ID, status: "resolved" } });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - accepted_lead_id not a member of this escalation -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ accepted_lead_id: "some-other-lead" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("PIN gate - wrong PIN -> 400, before anything is written", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ pin: "0000" }), client as never);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Incorrect PIN.");
});

Deno.test("success - an accepted lead that had already cleared Recommending Authority resumes straight at md_review", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const leadUpdates = log.filter((l) => l.table === "leads" && l.calls.some(([name]) => name === "update"));
  assertEquals(leadUpdates.length, 2); // one accept, one drop
  const updatePayloads = leadUpdates.map((l) => JSON.parse(l.calls.find(([name]) => name === "update")![1]).status);
  assertEquals(updatePayloads.sort(), ["md_review", "pa_dropped"]);

  const activityActions = log
    .filter((l) => l.table === "lead_activity_log" && l.calls.some(([name]) => name === "insert"))
    .map((l) => JSON.parse(l.calls.find(([name]) => name === "insert")![1]).action);
  assertEquals(activityActions.sort(), ["g3_accepted", "g3_dropped"]);

  const escalationUpdate = log.find((l, i) => l.table === "lead_g3_escalations" && i > 0 && l.calls.some(([name]) => name === "update"));
  assertEquals(!!escalationUpdate, true);
  const resolvedPayload = JSON.parse(escalationUpdate!.calls.find(([name]) => name === "update")![1]);
  assertEquals(resolvedPayload.status, "resolved");
  assertEquals(resolvedPayload.accepted_lead_id, ACCEPTED_ID);
});

Deno.test("success - an accepted lead that hadn't reached Recommending Authority yet is restored to exactly its previous stage", async () => {
  const client = buildClient({ members: memberRows({ acceptedPreviousStatus: "pa_review" }) });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 200);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const leadUpdates = log.filter((l) => l.table === "leads" && l.calls.some(([name]) => name === "update"));
  const statuses = leadUpdates.map((l) => JSON.parse(l.calls.find(([name]) => name === "update")![1]).status);
  assertEquals(statuses.sort(), ["pa_dropped", "pa_review"]);
});

Deno.test("notifications - both leads' creator, Person Responsible, Reviewer and Recommending Authority hear the outcome", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 200);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const batches = log
    .filter((l) => l.table === "notifications" && l.calls.some(([name]) => name === "insert"))
    .map((l) => JSON.parse(l.calls.find(([name]) => name === "insert")![1]) as { user_id: string; title: string }[]);
  assertEquals(batches.length, 2);

  const accepted = batches.find((b) => b[0].title.includes("accepted"))!;
  assertEquals(accepted.map((n) => n.user_id).sort(), ["creator-1", "pr-1", "ra-1", "rev-1"]);

  // pr-2 is both Person Responsible and Recommending Authority: notified once.
  const rejected = batches.find((b) => b[0].title.includes("rejected"))!;
  assertEquals(rejected.map((n) => n.user_id).sort(), ["creator-2", "pr-2", "rev-2"]);
});
