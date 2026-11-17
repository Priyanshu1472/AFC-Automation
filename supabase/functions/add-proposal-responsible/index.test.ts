import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const TARGET_ID = "target-1";
const LEAD_ID = "lead-1";
const PROPOSAL_ID = "proposal-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", teams: ["BPDD"], office: "delhi", committee: null, is_active: true, email: "caller@afc.com", ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, lead_number: "AFC/BPDD/L/26/001", title: "Test Lead", status: "md_approved", team: "BPDD",
    submission_deadline: null, person_responsible_id: CALLER_ID, reviewer_id: "reviewer-1", recommending_authority_id: "ra-1",
    ...overrides,
  };
}

function proposalRow(overrides: Record<string, unknown> = {}) {
  return { id: PROPOSAL_ID, lead_id: LEAD_ID, locked: false, ...overrides };
}

function targetRow(overrides: Record<string, unknown> = {}) {
  return { id: TARGET_ID, full_name: "Target User", role: "project_officer", team: "BPDD", is_active: true, ...overrides };
}

// Within one request, checkCanEditProposal's own "already an additional
// responsible?" select only runs when the caller isn't named on the lead
// (and then the handler returns before ever reaching the insert below) —
// so exactly ONE access to proposal_additional_responsibles ever happens
// per request, whichever one applies. `parFirstCallResult` is that one
// result, whether it's standing in for the select (stranger-caller tests)
// or the insert (every other test).
function buildClient(opts: {
  caller?: Record<string, unknown>;
  lead?: Record<string, unknown>;
  proposal?: Record<string, unknown>;
  target?: Record<string, unknown>;
  parFirstCallResult?: Record<string, unknown>;
}) {
  return createFakeAdminClient({
    afc_users: [
      { data: opts.caller ?? callerRow(), error: null },
      { data: opts.target === null ? null : (opts.target ?? targetRow()), error: null },
      { data: { full_name: "Caller Name" }, error: null },
    ],
    leads: [{ data: opts.lead === null ? null : (opts.lead ?? leadRow()), error: null }],
    proposal_preparations: [{ data: opts.proposal === null ? null : (opts.proposal ?? proposalRow()), error: null }],
    proposal_additional_responsibles: [opts.parFirstCallResult ?? { data: null, error: null }],
  });
}

function req(body: Record<string, unknown> = {}) {
  return authedReq("https://x.com/add-proposal-responsible", { token: fakeJwt({ sub: CALLER_ID }), body: { lead_id: LEAD_ID, user_id: TARGET_ID, ...body } });
}

Deno.test("add-proposal-responsible - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("add-proposal-responsible - caller not named on the lead and not already added -> 403", async () => {
  const client = buildClient({ caller: callerRow({ id: "stranger", role: "project_officer" }), parFirstCallResult: { data: null, error: null } });
  const res = await handleRequest(authedReq("https://x.com/add-proposal-responsible", { token: fakeJwt({ sub: "stranger" }), body: { lead_id: LEAD_ID, user_id: TARGET_ID } }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("add-proposal-responsible - proposal locked -> 400", async () => {
  const client = buildClient({ proposal: proposalRow({ locked: true }) });
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 400);
});

Deno.test("add-proposal-responsible - deadline already passed -> 400", async () => {
  const client = buildClient({ lead: leadRow({ submission_deadline: "2000-01-01" }) });
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 400);
});

Deno.test("add-proposal-responsible - target on a different team -> 400", async () => {
  const client = buildClient({ target: targetRow({ team: "LKN" }) });
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 400);
});

Deno.test("add-proposal-responsible - target holds an excluded role -> 400", async () => {
  const client = buildClient({ target: targetRow({ role: "dgm" }) });
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 400);
});

Deno.test("add-proposal-responsible - target already named on the lead -> 400", async () => {
  const client = buildClient({ lead: leadRow({ reviewer_id: TARGET_ID }) });
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 400);
});

Deno.test("add-proposal-responsible - duplicate add -> 400", async () => {
  const client = buildClient({ parFirstCallResult: { data: null, error: { code: "23505", message: "duplicate" } } });
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 400);
});

Deno.test("add-proposal-responsible - success: inserts, upserts chat roster, logs activity, notifies the target", async () => {
  const client = buildClient({});
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;

  const parInsert = log.filter((l) => l.table === "proposal_additional_responsibles").flatMap((l) => l.calls).find((c) => c[0] === "insert");
  const parInserted = JSON.parse(parInsert![1]);
  assertEquals(parInserted.proposal_id, PROPOSAL_ID);
  assertEquals(parInserted.user_id, TARGET_ID);

  const chatUpsert = log.filter((l) => l.table === "proposal_chat_participants").flatMap((l) => l.calls).find((c) => c[0] === "upsert");
  const chatRow = JSON.parse(chatUpsert![1]);
  assertEquals(chatRow.role_at_add, "additional_pr");

  const activityInsert = log.filter((l) => l.table === "lead_activity_log").flatMap((l) => l.calls).find((c) => c[0] === "insert");
  const activity = JSON.parse(activityInsert![1]);
  assertEquals(activity.action, "proposal_responsible_added");

  const notifInsert = log.filter((l) => l.table === "notifications").flatMap((l) => l.calls).find((c) => c[0] === "insert");
  const notified = JSON.parse(notifInsert![1]);
  assertEquals(notified[0].user_id, TARGET_ID);
  assertEquals(notified[0].link, `/proposals/${LEAD_ID}`);
});
