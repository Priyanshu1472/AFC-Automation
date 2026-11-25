import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "pr-1";
const LEAD_ID = "lead-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", teams: ["BPDD"], office: "delhi", committee: null, is_active: true, email: "pr@afc.com", ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, lead_number: "AFC/BPDD/L/26/001", title: "Test Lead", status: "md_approved",
    person_responsible_id: CALLER_ID, submission_deadline: "2026-01-01",
    ...overrides,
  };
}

function buildClient(opts: { caller?: Record<string, unknown>; lead?: Record<string, unknown>; routes?: Record<string, { data: unknown; error: unknown }[]> }) {
  return createFakeAdminClient({
    afc_users: [{ data: opts.caller ?? callerRow(), error: null }],
    leads: [{ data: opts.lead === null ? null : (opts.lead ?? leadRow()), error: null }],
    ...(opts.routes || {}),
  });
}

function req(body: Record<string, unknown> = {}) {
  return authedReq("https://x.com/update-lead-due-date", { token: fakeJwt({ sub: CALLER_ID }), body: { lead_id: LEAD_ID, submission_deadline: "2026-06-15", ...body } });
}

Deno.test("update-lead-due-date - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("update-lead-due-date - missing date -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ submission_deadline: "" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("update-lead-due-date - malformed date -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({ submission_deadline: "15-06-2026" }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("update-lead-due-date - lead not md_approved -> 400", async () => {
  const client = buildClient({ lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 400);
});

Deno.test("update-lead-due-date - caller is not the Person Responsible -> 403", async () => {
  const client = buildClient({ caller: callerRow({ id: "someone-else" }) });
  const res = await handleRequest(authedReq("https://x.com/update-lead-due-date", { token: fakeJwt({ sub: "someone-else" }), body: { lead_id: LEAD_ID, submission_deadline: "2026-06-15" } }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("update-lead-due-date - an additional Person Responsible (not the named PR) can still update it", async () => {
  const client = buildClient({
    caller: callerRow({ id: "teammate-1" }),
    lead: leadRow({ person_responsible_id: CALLER_ID }),
    routes: { lead_additional_responsibles: [{ data: { id: "lar-1" }, error: null }] },
  });
  const res = await handleRequest(authedReq("https://x.com/update-lead-due-date", { token: fakeJwt({ sub: "teammate-1" }), body: { lead_id: LEAD_ID, submission_deadline: "2026-06-15" } }), client as never);
  assertEquals(res.status, 200);
});

Deno.test("update-lead-due-date - success updates the date and logs activity", async () => {
  const client = buildClient({});
  const res = await handleRequest(req(), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;

  const updateCall = log.filter((l) => l.table === "leads").flatMap((l) => l.calls).find((c) => c[0] === "update");
  const updated = JSON.parse(updateCall![1]);
  assertEquals(updated.submission_deadline, "2026-06-15");

  const activityInsert = log.filter((l) => l.table === "lead_activity_log").flatMap((l) => l.calls).find((c) => c[0] === "insert");
  const activity = JSON.parse(activityInsert![1]);
  assertEquals(activity.action, "due_date_updated");
});
