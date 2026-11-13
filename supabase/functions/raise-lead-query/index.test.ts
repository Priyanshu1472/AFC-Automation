import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const LEAD_ID = "lead-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "dgm", team: "BIID", teams: ["BIID"], office: "delhi", committee: null, is_active: true, email: "caller@afc.com", ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return { id: LEAD_ID, lead_number: "AFC/BPDD/L/26/001", title: "Test Lead", team: "BPDD", status: "pa_review", ...overrides };
}

function buildClient(opts: {
  caller?: Record<string, unknown>;
  lead?: Record<string, unknown>;
  existingOpen?: Record<string, unknown> | null;
}) {
  return createFakeAdminClient({
    afc_users: [{ data: opts.caller ?? callerRow(), error: null }, { data: [{ id: "pmt-member-1" }], error: null }],
    leads: [{ data: opts.lead ?? leadRow(), error: null }, { data: { id: LEAD_ID }, error: null }],
    lead_queries: [{ data: opts.existingOpen === undefined ? null : opts.existingOpen, error: null }, { data: null, error: null }],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/raise-lead-query", { token: fakeJwt({ sub: CALLER_ID }), body: { lead_id: LEAD_ID, justification: "They have stronger sector experience.", ...body } });
}

Deno.test("raise-lead-query - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("raise-lead-query - rejects a role that isn't DGM/GM/AGM/SRM", async () => {
  const client = buildClient({ caller: callerRow({ role: "project_officer" }) });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 403);
});

Deno.test("raise-lead-query - rejects raising a query on your own team's lead", async () => {
  const client = buildClient({ caller: callerRow({ team: "BPDD", teams: ["BPDD"] }), lead: leadRow({ team: "BPDD" }) });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("raise-lead-query - rejects when an open query already exists", async () => {
  const client = buildClient({ existingOpen: { id: "q-1", raised_by_id: "someone-else", raised_by_team: "LKN" } });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("raise-lead-query - a query on a non-approved lead does not change its status", async () => {
  const client = buildClient({ lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 200);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const leadsUpdateCalls = log.filter((l) => l.table === "leads").flatMap((l) => l.calls).filter((c) => c[0] === "update");
  assertEquals(leadsUpdateCalls.length, 0);

  const notifCall = log.find((l) => l.table === "notifications")?.calls.find((c) => c[0] === "insert");
  const inserted = JSON.parse(notifCall![1]);
  assertEquals(inserted[0].title, "Cross-team query raised on a lead");
});

Deno.test("raise-lead-query - a query on an md_approved lead reopens it to pmt_review and notifies PMT accordingly", async () => {
  const client = buildClient({ lead: leadRow({ status: "md_approved" }) });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 200);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const leadsUpdateCall = log.filter((l) => l.table === "leads").flatMap((l) => l.calls).find((c) => c[0] === "update");
  const updated = JSON.parse(leadsUpdateCall![1]);
  assertEquals(updated.status, "pmt_review");

  const activityInserts = log.filter((l) => l.table === "lead_activity_log").flatMap((l) => l.calls).filter((c) => c[0] === "insert").map((c) => JSON.parse(c[1]));
  const reopenEntry = activityInserts.find((a) => a.action === "reopened_to_pmt");
  assertEquals(reopenEntry.from_status, "md_approved");
  assertEquals(reopenEntry.to_status, "pmt_review");

  const notifCall = log.find((l) => l.table === "notifications")?.calls.find((c) => c[0] === "insert");
  const inserted = JSON.parse(notifCall![1]);
  assertEquals(inserted[0].title, "Approved lead reopened — cross-team query raised");
});
