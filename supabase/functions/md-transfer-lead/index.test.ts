import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

const CALLER_ID = "md-1";
const LEAD_ID = "lead-1";
const TARGET_TEAM = "Team 2";
const FORWARD_TO_ID = "target-user-1";

const CALLER_PIN = "5432";
const CALLER_PIN_HASH = await hashPin(CALLER_PIN, CALLER_ID);

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "md", team: null, office: "delhi", committee: null, is_active: true, email: "md@afc.com", pin_hash: CALLER_PIN_HASH, ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, lead_number: "AFC/TEAM 1/L/26/001", title: "Test Lead", team: "Team 1", status: "pmt_review",
    transfer_count: 0, person_responsible_id: "pr-1", forwarded_to_id: null, ...overrides,
  };
}

// afc_users is consumed in order: [0] caller, [1] validateForwardedTo's
// target-user check (single row), [2] performLeadTransfer's target-team
// existence check (single row), [3] notifyTeam's lookup (array), [4]
// getOrgWideHolders(role:"md") (array) — the fake repeats the last entry
// once exhausted.
function buildClient(opts: {
  caller?: Record<string, unknown>;
  lead?: Record<string, unknown>;
  targetUser?: FakeResult;
  routes?: Record<string, FakeResult[]>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [
    { data: opts.caller ?? callerRow(), error: null },
    opts.targetUser ?? { data: { id: FORWARD_TO_ID, is_active: true }, error: null },
    { data: { id: "someone-on-target-team" }, error: null },
    { data: [{ id: "teammate-1" }], error: null },
    { data: [{ id: CALLER_ID }], error: null },
    ...(routes.afc_users || []),
  ];
  routes.afc_user_teams = [
    { data: [], error: null },
    { data: { user_id: FORWARD_TO_ID }, error: null },
    ...(routes.afc_user_teams || []),
  ];
  routes.leads = [
    { data: opts.lead ?? leadRow(), error: null },
    { data: null, error: null },
    ...(routes.leads || []),
  ];
  routes.lead_chat_participants = routes.lead_chat_participants || [{ data: null, error: null }];
  routes.notifications = routes.notifications || [{ data: null, error: null }];
  routes.lead_activity_log = routes.lead_activity_log || [{ data: null, error: null }];
  return createFakeAdminClient(routes, { rpc: { next_lead_number: { data: "AFC/TEAM 2/L/26/010", error: null } } });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/md-transfer-lead", {
    token: fakeJwt({ sub: CALLER_ID }),
    body: { lead_id: LEAD_ID, target_team: TARGET_TEAM, forwarded_to_id: FORWARD_TO_ID, comment: "Reassigning to the right team.", pin: CALLER_PIN, ...body },
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

Deno.test("handleRequest - missing target_team -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ target_team: "" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - missing forwarded_to_id -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ forwarded_to_id: "" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - missing comment -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ comment: "" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("PIN gate - wrong PIN -> 400, before anything is written", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ pin: "0000" }), client as never);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Incorrect PIN.");
});

Deno.test("handleRequest - target team same as current team -> 400", async () => {
  const client = buildClient({ lead: leadRow({ team: TARGET_TEAM }) });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("success - transfers the lead to the new team and person, notifying old owner, new assignee, old team and MD", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.lead_number, "AFC/TEAM 2/L/26/010");

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const leadUpdate = log.find((l) => l.table === "leads" && l.calls.some(([name]) => name === "update"));
  assertEquals(!!leadUpdate, true);
  const updatePayload = JSON.parse(leadUpdate!.calls.find(([name]) => name === "update")![1]);
  assertEquals(updatePayload.status, "po_assignment");
  assertEquals(updatePayload.team, TARGET_TEAM);
  assertEquals(updatePayload.forwarded_to_id, FORWARD_TO_ID);

  const activityInsert = log.find((l) => l.table === "lead_activity_log" && l.calls.some(([name]) => name === "insert"));
  assertEquals(!!activityInsert, true);

  const notificationsInserts = log.filter((l) => l.table === "notifications" && l.calls.some(([name]) => name === "insert"));
  assertEquals(notificationsInserts.length >= 3, true); // new assignee + old owner + old team/MD fan-out
});
