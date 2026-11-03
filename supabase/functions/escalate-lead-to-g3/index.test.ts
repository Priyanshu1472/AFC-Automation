import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

const CALLER_ID = "pmt-1";
const LEAD_ID = "lead-1";
const CONFLICT_ID = "lead-2";

const CALLER_PIN = "5432";
const CALLER_PIN_HASH = await hashPin(CALLER_PIN, CALLER_ID);

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "Team 1", office: "delhi", committee: "PMT", is_active: true, email: "pmt@afc.com", pin_hash: CALLER_PIN_HASH, ...overrides };
}

function primaryLeadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, lead_number: "AFC/TEAM 1/L/26/001", title: "Primary Lead", team: "Team 1", status: "pmt_review",
    chat_opened_at: "2026-11-01T00:00:00Z", created_by: "creator-1", person_responsible_id: "pr-1", ...overrides,
  };
}

function conflictLeadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFLICT_ID, lead_number: "AFC/TEAM 2/L/26/002", title: "Conflicting Lead", team: "Team 2", status: "pmt_review",
    chat_opened_at: "2026-11-01T00:00:00Z", created_by: "creator-2", person_responsible_id: "pr-2", ...overrides,
  };
}

// afc_users is consumed: [0] caller (getCallerProfile), [1] the
// assigned_g3_ids validation lookup, [2] MD holders, [3] PMT holders (in
// that call order) — the fake repeats the last entry once exhausted, which
// also harmlessly backs regenerateApprovalNote's own best-effort internal
// lookups.
function buildClient(opts: {
  caller?: Record<string, unknown>;
  leads?: Record<string, unknown>[];
  g3Validation?: Record<string, unknown>[];
  routes?: Record<string, FakeResult[]>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [
    { data: opts.caller ?? callerRow(), error: null },
    { data: opts.g3Validation ?? [{ id: "g3-1" }], error: null },
    { data: [{ id: "md-1" }], error: null },
    { data: [{ id: CALLER_ID }], error: null },
    ...(routes.afc_users || []),
  ];
  routes.afc_user_teams = routes.afc_user_teams || [{ data: [], error: null }];
  routes.leads = [
    { data: opts.leads ?? [primaryLeadRow(), conflictLeadRow()], error: null },
    { data: [{ id: LEAD_ID }], error: null },
    ...(routes.leads || []),
  ];
  routes.lead_g3_escalations = routes.lead_g3_escalations || [{ data: { id: "esc-1" }, error: null }];
  routes.lead_g3_escalation_members = routes.lead_g3_escalation_members || [{ data: null, error: null }];
  routes.lead_g3_escalation_assignees = routes.lead_g3_escalation_assignees || [{ data: null, error: null }];
  routes.lead_activity_log = routes.lead_activity_log || [{ data: null, error: null }];
  routes.lead_chat_participants = routes.lead_chat_participants || [{ data: null, error: null }];
  routes.lead_chat_messages = routes.lead_chat_messages || [{ data: null, error: null }];
  routes.notifications = routes.notifications || [{ data: null, error: null }];
  return createFakeAdminClient(routes);
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/escalate-lead-to-g3", {
    token: fakeJwt({ sub: CALLER_ID }),
    body: {
      lead_id: LEAD_ID, conflict_lead_ids: [CONFLICT_ID], assigned_g3_ids: ["g3-1"],
      comment: "Looks like the same tender as Team 2's.", pin: CALLER_PIN, ...body,
    },
  });
}

Deno.test("handleRequest - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - non-PMT caller -> 403", async () => {
  const client = buildClient({ caller: callerRow({ committee: null }) });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - missing lead_id -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ lead_id: "" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - missing comment -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ comment: "" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - no conflicting leads selected -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ conflict_lead_ids: [] }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - unknown lead -> 404", async () => {
  const client = buildClient({ leads: [conflictLeadRow()] });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - primary lead not at pmt_review -> 400", async () => {
  const client = buildClient({ leads: [primaryLeadRow({ status: "md_review" }), conflictLeadRow()] });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - a selected conflict lead at an ineligible status (already escalated, dropped, etc.) -> 400", async () => {
  const client = buildClient({ leads: [primaryLeadRow(), conflictLeadRow({ status: "g3_review" })] });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - a conflict lead can be at any eligible stage, not just pmt_review", async () => {
  const client = buildClient({ leads: [primaryLeadRow(), conflictLeadRow({ status: "pa_review" })] });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - a selected conflict lead that doesn't exist -> 404", async () => {
  const client = buildClient({ leads: [primaryLeadRow()] });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - no G3 members selected -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ assigned_g3_ids: [] }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - a selected G3 member isn't an active G3 committee member -> 400", async () => {
  const client = buildClient({ g3Validation: [] });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("PIN gate - wrong PIN -> 400, before anything is written", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ pin: "0000" }), client as never);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Incorrect PIN.");
});

Deno.test("success - creates the escalation, moves every member lead to g3_review, and notifies G3 + MD", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const escalationInsert = log.find((l) => l.table === "lead_g3_escalations" && l.calls.some(([name]) => name === "insert"));
  assertEquals(!!escalationInsert, true);

  const membersInsert = log.find((l) => l.table === "lead_g3_escalation_members" && l.calls.some(([name]) => name === "insert"));
  assertEquals(!!membersInsert, true);
  const insertedMembers = JSON.parse(membersInsert!.calls.find(([name]) => name === "insert")![1]);
  assertEquals(insertedMembers.length, 2);
  assertEquals(insertedMembers.every((m: { previous_status: string }) => m.previous_status === "pmt_review"), true);

  const assigneesInsert = log.find((l) => l.table === "lead_g3_escalation_assignees" && l.calls.some(([name]) => name === "insert"));
  assertEquals(!!assigneesInsert, true);
  const insertedAssignees = JSON.parse(assigneesInsert!.calls.find(([name]) => name === "insert")![1]);
  assertEquals(insertedAssignees, [{ escalation_id: "esc-1", user_id: "g3-1" }]);

  const statusUpdates = log.filter((l) => l.table === "leads" && l.calls.some(([name]) => name === "update"));
  assertEquals(statusUpdates.length >= 1, true);

  const notificationsInsert = log.find((l) => l.table === "notifications" && l.calls.some(([name]) => name === "insert"));
  assertEquals(!!notificationsInsert, true);
  const notifiedIds = JSON.parse(notificationsInsert!.calls.find(([name]) => name === "insert")![1]).map((r: { user_id: string }) => r.user_id);
  assertEquals(notifiedIds.sort(), ["g3-1", "md-1"]);

  // PMT loses the chat it was already on for every member lead.
  const chatDeletes = log.filter((l) => l.table === "lead_chat_participants" && l.calls.some(([name]) => name === "delete"));
  assertEquals(chatDeletes.length, 2);
});
