import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const LEAD_ID = "lead-1";
const PR_ID = "pr-1";
const REVIEWER_ID = "reviewer-1";
const AUTHORITY_ID = "authority-1";
const BA_ID = "ba-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: "BPDD", office: "delhi", committee: null, is_active: true, email: "caller@afc.com", pin_hash: null, ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, status: "md_approved",
    person_responsible_id: PR_ID, reviewer_id: REVIEWER_ID, approval_authority_id: AUTHORITY_ID, assigned_ba_id: BA_ID,
    ...overrides,
  };
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/create-proposal-preparation", { token: fakeJwt({ sub: CALLER_ID }), body });
}

Deno.test("OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), createFakeAdminClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), createFakeAdminClient({}) as never);
  assertEquals(res.status, 405);
});

Deno.test("unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), createFakeAdminClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("missing lead_id -> 400", async () => {
  const client = createFakeAdminClient({ afc_users: [{ data: callerRow(), error: null }] });
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("unknown lead -> 404", async () => {
  const client = createFakeAdminClient({ afc_users: [{ data: callerRow(), error: null }], leads: [{ data: null, error: null }] });
  const res = await handleRequest(req({ lead_id: "nope" }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("rejects a caller with no access to the lead", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow({ id: "someone-else" }), error: null }],
    leads: [{ data: leadRow(), error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("rejects a lead that isn't md_approved yet", async () => {
  const client = createFakeAdminClient({
    afc_users: [{ data: callerRow({ id: PR_ID }), error: null }],
    leads: [{ data: leadRow({ status: "pmt_review" }), error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("an already-open proposal returns the existing id, without inserting a second row, but still re-syncs its roster", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow({ id: PR_ID }), error: null },
      { data: [{ id: "md-1" }], error: null }, // getOrgWideHolders(md)
    ],
    leads: [{ data: leadRow(), error: null }],
    proposal_preparations: [{ data: { id: "existing-proposal-1", chat_opened_at: "2026-09-01T00:00:00Z" }, error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, proposal_id: "existing-proposal-1" });

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  assertEquals(log.filter((l) => l.table === "proposal_preparations" && l.calls.some((c) => c[0] === "insert")).length, 0);
  assertEquals(log.filter((l) => l.table === "proposal_chat_participants").length, 2);
});

Deno.test("an existing proposal predating the chat feature (chat_opened_at null) gets it backfilled", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow({ id: PR_ID }), error: null },
      { data: [{ id: "md-1" }], error: null },
    ],
    leads: [{ data: leadRow(), error: null }],
    proposal_preparations: [{ data: { id: "existing-proposal-2", chat_opened_at: null }, error: null }],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 200);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const updateCall = log.find((l) => l.table === "proposal_preparations" && l.calls.some((c) => c[0] === "update"));
  const updateBody = JSON.parse(updateCall!.calls.find((c) => c[0] === "update")![1]);
  assertEquals(typeof updateBody.chat_opened_at, "string");
});

Deno.test("creates a new proposal, opens its chat, and rosters PR/Reviewer/Approval Authority/BP/every MD", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow({ id: PR_ID }), error: null }, // getCallerProfile
      { data: [{ id: "md-1" }, { id: "md-2" }], error: null }, // getOrgWideHolders(md)
    ],
    leads: [{ data: leadRow(), error: null }],
    proposal_preparations: [
      { data: null, error: null }, // no existing proposal
      { data: { id: "new-proposal-1" }, error: null }, // insert
    ],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true, proposal_id: "new-proposal-1" });

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const insertCall = log.find((l) => l.table === "proposal_preparations" && l.calls.some((c) => c[0] === "insert"));
  const insertBody = JSON.parse(insertCall!.calls.find((c) => c[0] === "insert")![1]);
  assertEquals(typeof insertBody.chat_opened_at, "string");

  const participantCalls = log.filter((l) => l.table === "proposal_chat_participants");
  assertEquals(participantCalls.length, 2);
  const namedRows = JSON.parse(participantCalls[0].calls.find((c) => c[0] === "upsert")![1]);
  assertEquals(namedRows.map((r: { user_id: string }) => r.user_id).sort(), [PR_ID, REVIEWER_ID, AUTHORITY_ID, BA_ID].sort());
  assertEquals(namedRows[0].role_at_add, "named");
  const mdRows = JSON.parse(participantCalls[1].calls.find((c) => c[0] === "upsert")![1]);
  assertEquals(mdRows.map((r: { user_id: string }) => r.user_id).sort(), ["md-1", "md-2"]);
  assertEquals(mdRows[0].role_at_add, "md");
});

Deno.test("a proposal with no assigned Business Partner still rosters just the three named assignees plus MD", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow({ id: PR_ID }), error: null },
      { data: [{ id: "md-1" }], error: null },
    ],
    leads: [{ data: leadRow({ assigned_ba_id: null }), error: null }],
    proposal_preparations: [
      { data: null, error: null },
      { data: { id: "new-proposal-2" }, error: null },
    ],
  });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 200);

  const log = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log;
  const participantCalls = log.filter((l) => l.table === "proposal_chat_participants");
  const namedRows = JSON.parse(participantCalls[0].calls.find((c) => c[0] === "upsert")![1]);
  assertEquals(namedRows.map((r: { user_id: string }) => r.user_id).sort(), [PR_ID, REVIEWER_ID, AUTHORITY_ID].sort());
});
