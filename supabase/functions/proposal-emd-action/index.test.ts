import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, type FakeResult } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";

const PIN = "1234";
const LEAD = { id: "lead-1", lead_number: "AFC/TEAM 1/L/26/001", title: "DPR", person_responsible_id: "pr-1", reviewer_id: "rev-1", recommending_authority_id: "ra-1" };

async function userRow(id: string, role = "project_officer") {
  return { id, role, is_active: true, email: `${id}@afc.com`, pin_hash: await hashPin(PIN, id) };
}

function client(opts: {
  caller: Record<string, unknown>;
  member?: boolean;
  response?: string;
  tracking?: Record<string, unknown> | null;
  note?: Record<string, unknown> | null;
  fileCount?: number;
  updated?: unknown[];
}) {
  const routes: Record<string, FakeResult[]> = {
    afc_users: [{ data: opts.caller, error: null }, { data: { accounts_committee: opts.member ?? false, is_active: true }, error: null }],
    proposal_preparations: [{ data: { id: "prop-1", lead_id: "lead-1", locked: true, client_response: opts.response ?? "rejected" }, error: null }],
    leads: [{ data: LEAD, error: null }],
    proposal_emd_tracking: [{ data: opts.tracking ?? null, error: null }, { data: opts.updated ?? [{ id: "t-1" }], error: null }],
    fee_notes: [{ data: opts.note === undefined ? { emd_amount: 50000, status: "approved" } : opts.note, error: null }],
    proposal_finance_files: [{ data: null, error: null, count: opts.fileCount ?? 0 }],
  };
  return createFakeAdminClient(routes);
}

const req = (sub: string, body: Record<string, unknown>) =>
  authedReq("https://x.com/proposal-emd-action", { token: fakeJwt({ sub }), body: { proposal_id: "prop-1", ...body } });

const writeOf = (fake: ReturnType<typeof createFakeAdminClient>, table: string) =>
  fake.__log.filter((l) => l.table === table).flatMap((l) => l.calls).find((c) => c[0] === "update" || c[0] === "insert");

Deno.test("proposal-emd-action - needs the client's response first", async () => {
  const res = await handleRequest(req("pr-1", { action: "choose_track", track: "refund" }), client({ caller: await userRow("pr-1"), response: "pending" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-emd-action - outsiders can't act for the team", async () => {
  const res = await handleRequest(req("x-1", { action: "choose_track", track: "refund" }), client({ caller: await userRow("x-1") }) as never);
  assertEquals(res.status, 403);
});

Deno.test("proposal-emd-action - PBG only for an awarded proposal", async () => {
  const res = await handleRequest(req("pr-1", { action: "choose_track", track: "pbg" }), client({ caller: await userRow("pr-1"), response: "rejected" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-emd-action - awarded proposal can choose PBG", async () => {
  const fake = client({ caller: await userRow("pr-1"), response: "awarded" });
  const res = await handleRequest(req("pr-1", { action: "choose_track", track: "pbg" }), fake as never);
  assertEquals(res.status, 200);
  const write = writeOf(fake, "proposal_emd_tracking");
  assertMatch(write![1], /"track":"pbg"/);
  assertMatch(write![1], /"status":"draft"/);
  assertMatch(write![1], /"emd_amount":50000/);
});

Deno.test("proposal-emd-action - no EMD on the note, nothing to track", async () => {
  const res = await handleRequest(
    req("pr-1", { action: "choose_track", track: "refund" }),
    client({ caller: await userRow("pr-1"), response: "awarded", note: { emd_amount: null, status: "approved" } }) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("proposal-emd-action - refund can't be forwarded before it's received", async () => {
  const tracking = { id: "t-1", track: "refund", status: "pending", emd_amount: 50000 };
  const res = await handleRequest(req("pr-1", { action: "forward" }), client({ caller: await userRow("pr-1"), tracking }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-emd-action - forwarding needs a proof", async () => {
  const tracking = { id: "t-1", track: "refund", status: "received", emd_amount: 50000 };
  const res = await handleRequest(req("pr-1", { action: "forward" }), client({ caller: await userRow("pr-1"), tracking, fileCount: 0 }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-emd-action - received refund with proof goes to Accounts", async () => {
  const tracking = { id: "t-1", track: "refund", status: "received", emd_amount: 50000 };
  const fake = client({ caller: await userRow("pr-1"), tracking, fileCount: 2 });
  const res = await handleRequest(req("pr-1", { action: "forward", remark: "Credited on 10 Nov" }), fake as never);
  assertEquals(res.status, 200);
  assertMatch(writeOf(fake, "proposal_emd_tracking")![1], /"status":"pending_accounts"/);
});

Deno.test("proposal-emd-action - PBG forward needs the PBG amount", async () => {
  const tracking = { id: "t-1", track: "pbg", status: "draft", emd_amount: 50000, pbg_amount: null };
  const res = await handleRequest(req("pr-1", { action: "forward" }), client({ caller: await userRow("pr-1"), response: "awarded", tracking, fileCount: 1 }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-emd-action - only Accounts can verify", async () => {
  const tracking = { id: "t-1", track: "refund", status: "pending_accounts", emd_amount: 50000 };
  const res = await handleRequest(req("pr-1", { action: "verify", pin: PIN }), client({ caller: await userRow("pr-1"), tracking, member: false }) as never);
  assertEquals(res.status, 403);
});

Deno.test("proposal-emd-action - Accounts verifies with PIN", async () => {
  const tracking = { id: "t-1", track: "refund", status: "pending_accounts", emd_amount: 50000 };
  const fake = client({ caller: await userRow("acc-1"), tracking, member: true });
  const res = await handleRequest(req("acc-1", { action: "verify", pin: PIN, remark: "Checked bank statement" }), fake as never);
  assertEquals(res.status, 200);
  const write = writeOf(fake, "proposal_emd_tracking");
  assertMatch(write![1], /"status":"completed"/);
  assertMatch(write![1], /"completed_by":"acc-1"/);
});

Deno.test("proposal-emd-action - send back needs a remark", async () => {
  const tracking = { id: "t-1", track: "pbg", status: "pending_accounts", emd_amount: 50000, pbg_amount: 100000 };
  const res = await handleRequest(req("acc-1", { action: "send_back" }), client({ caller: await userRow("acc-1"), tracking, member: true, response: "awarded" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-emd-action - send back returns a PBG to draft", async () => {
  const tracking = { id: "t-1", track: "pbg", status: "pending_accounts", emd_amount: 50000, pbg_amount: 100000 };
  const fake = client({ caller: await userRow("acc-1"), tracking, member: true, response: "awarded" });
  const res = await handleRequest(req("acc-1", { action: "send_back", remark: "Proof is unreadable" }), fake as never);
  assertEquals(res.status, 200);
  assertMatch(writeOf(fake, "proposal_emd_tracking")![1], /"status":"draft"/);
});
