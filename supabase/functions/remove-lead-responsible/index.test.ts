import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const TARGET_ID = "target-1";
const LEAD_ID = "lead-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", teams: ["BPDD"], office: "delhi", committee: null, is_active: true, email: "caller@afc.com", ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, lead_number: "AFC/BPDD/L/26/001", title: "Test Lead", status: "md_approved", team: "BPDD",
    person_responsible_id: CALLER_ID, reviewer_id: "reviewer-1", recommending_authority_id: "ra-1",
    ...overrides,
  };
}

function buildClient(opts: {
  caller?: Record<string, unknown>;
  lead?: Record<string, unknown>;
  larFirstCallResult?: Record<string, unknown>;
}) {
  return createFakeAdminClient({
    afc_users: [
      { data: opts.caller ?? callerRow(), error: null },
      { data: { full_name: "Target User" }, error: null },
    ],
    leads: [{ data: opts.lead === null ? null : (opts.lead ?? leadRow()), error: null }],
    lead_additional_responsibles: [opts.larFirstCallResult ?? { data: null, error: null }],
  });
}

function req(body: Record<string, unknown> = {}) {
  return authedReq("https://x.com/remove-lead-responsible", { token: fakeJwt({ sub: CALLER_ID }), body: { lead_id: LEAD_ID, user_id: TARGET_ID, ...body } });
}

Deno.test("remove-lead-responsible - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("remove-lead-responsible - caller not named and not an additional responsible -> 403", async () => {
  const client = buildClient({ caller: callerRow({ id: "stranger" }), larFirstCallResult: { data: null, error: null } });
  const res = await handleRequest(authedReq("https://x.com/remove-lead-responsible", { token: fakeJwt({ sub: "stranger" }), body: { lead_id: LEAD_ID, user_id: TARGET_ID } }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("remove-lead-responsible - lead already dropped -> 400", async () => {
  const client = buildClient({ lead: leadRow({ status: "pa_dropped" }) });
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 400);
});

Deno.test("remove-lead-responsible - success: deletes from both the responsibles table and the chat roster", async () => {
  const client = buildClient({});
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 200);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;

  const larDelete = log.filter((l) => l.table === "lead_additional_responsibles").flatMap((l) => l.calls).find((c) => c[0] === "delete");
  const larDeleteEq = log.filter((l) => l.table === "lead_additional_responsibles").flatMap((l) => l.calls).filter((c) => c[0] === "eq");
  const chatDelete = log.filter((l) => l.table === "lead_chat_participants").flatMap((l) => l.calls).find((c) => c[0] === "delete");

  assertEquals(!!larDelete, true);
  assertEquals(larDeleteEq.length >= 2, true);
  assertEquals(!!chatDelete, true);

  const activityInsert = log.filter((l) => l.table === "lead_activity_log").flatMap((l) => l.calls).find((c) => c[0] === "insert");
  const activity = JSON.parse(activityInsert![1]);
  assertEquals(activity.action, "responsible_removed");
});
