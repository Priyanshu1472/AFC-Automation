import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, type FakeResult } from "../_shared/testHelpers.ts";
import { hashPin } from "../_shared/pin.ts";
import { pbgCalculationRows, emdContextOf } from "../_shared/pbgNotePdf.ts";

const PIN = "1234";
const LEAD = { id: "lead-1", lead_number: "AFC/TEAM 1/L/26/001", title: "CAT Plan", person_responsible_id: "pr-1", reviewer_id: "rev-1", recommending_authority_id: "ra-1" };

async function userRow(id: string, role = "project_officer") {
  return { id, role, is_active: true, email: `${id}@afc.com`, pin_hash: await hashPin(PIN, id) };
}

function client(opts: {
  caller: Record<string, unknown>;
  member?: boolean;
  response?: string;
  note?: Record<string, unknown> | null;
  track?: string | null;
  fileCount?: number;
}) {
  const routes: Record<string, FakeResult[]> = {
    afc_users: [{ data: opts.caller, error: null }, { data: { is_active: true }, error: null }, { data: [], error: null }],
    afc_user_committees: [
      { data: [], error: null },
      { data: (opts.member ?? false) ? { user_id: (opts.caller as { id: string }).id } : null, error: null },
    ],
    proposal_preparations: [{ data: { id: "prop-1", lead_id: "lead-1", locked: true, client_response: opts.response ?? "awarded" }, error: null }],
    leads: [{ data: LEAD, error: null }],
    proposal_additional_responsibles: [{ data: [], error: null }],
    proposal_pbg_notes: [{ data: opts.note ?? null, error: null }, { data: [{ id: "n-1" }], error: null }],
    fee_notes: [{ data: { emd_amount: 69000 }, error: null }],
    proposal_emd_tracking: [{ data: opts.track ? { id: "t-1", track: opts.track, status: opts.track === "pbg" ? "draft" : "pending" } : null, error: null }],
    proposal_finance_files: [{ data: null, error: null, count: opts.fileCount ?? 0 }],
  };
  return createFakeAdminClient(routes);
}

const req = (sub: string, body: Record<string, unknown>) =>
  authedReq("https://x.com/proposal-pbg-note", { token: fakeJwt({ sub }), body: { proposal_id: "prop-1", ...body } });

const writesOf = (fake: ReturnType<typeof createFakeAdminClient>, table: string) =>
  fake.__log.filter((l) => l.table === table).flatMap((l) => l.calls).filter((c) => c[0] === "update" || c[0] === "insert");

const draft = (extra: Record<string, unknown> = {}) => ({ id: "n-1", status: "draft", pbg_amount: 197900, emd_adjusted: 69000, return_to: null, ...extra });

Deno.test("proposal-pbg-note - only on an awarded proposal", async () => {
  const res = await handleRequest(req("pr-1", { action: "save", pbg_amount: 197900 }), client({ caller: await userRow("pr-1"), response: "rejected" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-pbg-note - a converted EMD is adjusted towards the PBG", async () => {
  const fake = client({ caller: await userRow("pr-1"), track: "pbg" });
  const res = await handleRequest(req("pr-1", { action: "save", pbg_amount: 197900, consultancy_fee: 1979000, content: { subject: "S", paragraphs: { award: "A", evil: "x" } } }), fake as never);
  assertEquals(res.status, 200);
  const insert = writesOf(fake, "proposal_pbg_notes")[0];
  assertMatch(insert[1], /"emd_adjusted":69000/);
  assertMatch(insert[1], /"pbg_amount":197900/);
  assertEquals(insert[1].includes("evil"), false);
});

Deno.test("proposal-pbg-note - a refunded EMD isn't adjusted, so the full PBG goes", async () => {
  const fake = client({ caller: await userRow("pr-1"), track: "refund" });
  const res = await handleRequest(req("pr-1", { action: "save", pbg_amount: 197900 }), fake as never);
  assertEquals(res.status, 200);
  assertMatch(writesOf(fake, "proposal_pbg_notes")[0][1], /"emd_adjusted":0/);
});

Deno.test("proposal-pbg-note - forwarding needs a proof", async () => {
  const res = await handleRequest(req("pr-1", { action: "forward", remark: "ok", pin: PIN }), client({ caller: await userRow("pr-1"), note: draft(), fileCount: 0 }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-pbg-note - the Person Responsible forwards to the RA and signs", async () => {
  const fake = client({ caller: await userRow("pr-1"), note: draft(), fileCount: 1, track: "pbg" });
  const res = await handleRequest(req("pr-1", { action: "forward", remark: "LoA attached", pin: PIN }), fake as never);
  assertEquals(res.status, 200);
  const upd = writesOf(fake, "proposal_pbg_notes")[0];
  assertMatch(upd[1], /"status":"pending_ra"/);
  assertMatch(upd[1], /"pr_signed_by":"pr-1"/);
});

Deno.test("proposal-pbg-note - the RA can't forward in the PR's name", async () => {
  const res = await handleRequest(req("ra-1", { action: "forward", remark: "x", pin: PIN }), client({ caller: await userRow("ra-1", "dgm"), note: draft(), fileCount: 1 }) as never);
  assertEquals(res.status, 403);
});

Deno.test("proposal-pbg-note - after a clarification it goes straight back to the stage that asked", async () => {
  const fake = client({ caller: await userRow("pr-1"), note: draft({ return_to: "pending_md" }), fileCount: 1 });
  const res = await handleRequest(req("pr-1", { action: "forward", remark: "Answered", pin: PIN }), fake as never);
  assertEquals(res.status, 200);
  assertMatch(writesOf(fake, "proposal_pbg_notes")[0][1], /"status":"pending_md"/);
});

Deno.test("proposal-pbg-note - only the lead's RA approves at RA stage", async () => {
  const res = await handleRequest(req("rev-1", { action: "ra_approve", pin: PIN }), client({ caller: await userRow("rev-1"), note: draft({ status: "pending_ra" }) }) as never);
  assertEquals(res.status, 403);
});

Deno.test("proposal-pbg-note - RA approval moves it to the MD", async () => {
  const fake = client({ caller: await userRow("ra-1", "dgm"), note: draft({ status: "pending_ra" }) });
  const res = await handleRequest(req("ra-1", { action: "ra_approve", pin: PIN }), fake as never);
  assertEquals(res.status, 200);
  const upd = writesOf(fake, "proposal_pbg_notes")[0];
  assertMatch(upd[1], /"status":"pending_md"/);
  assertMatch(upd[1], /"ra_signed_by":"ra-1"/);
});

Deno.test("proposal-pbg-note - MD Clarification Request remembers the stage", async () => {
  const fake = client({ caller: await userRow("md-1", "md"), note: draft({ status: "pending_md" }) });
  const res = await handleRequest(req("md-1", { action: "request_clarification", remark: "Why FDR?" }), fake as never);
  assertEquals(res.status, 200);
  const upd = writesOf(fake, "proposal_pbg_notes")[0];
  assertMatch(upd[1], /"status":"draft"/);
  assertMatch(upd[1], /"return_to":"pending_md"/);
});

Deno.test("proposal-pbg-note - a clarification needs a remark", async () => {
  const res = await handleRequest(req("md-1", { action: "request_clarification" }), client({ caller: await userRow("md-1", "md"), note: draft({ status: "pending_md" }) }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-pbg-note - the MD can't ask for clarification at the Accounts stage", async () => {
  const res = await handleRequest(req("md-1", { action: "request_clarification", remark: "x" }), client({ caller: await userRow("md-1", "md"), note: draft({ status: "pending_accounts" }) }) as never);
  assertEquals(res.status, 403);
});

Deno.test("proposal-pbg-note - Accounts approval leaves it pending payment", async () => {
  const fake = client({ caller: await userRow("acc-1"), member: true, note: draft({ status: "pending_accounts" }) });
  const res = await handleRequest(req("acc-1", { action: "accounts_approve", pin: PIN }), fake as never);
  assertEquals(res.status, 200);
  assertMatch(writesOf(fake, "proposal_pbg_notes")[0][1], /"status":"pending_payment"/);
});

Deno.test("proposal-pbg-note - payment done needs the payment proof", async () => {
  const res = await handleRequest(req("pr-1", { action: "mark_paid", pin: PIN }), client({ caller: await userRow("pr-1"), note: draft({ status: "pending_payment" }), fileCount: 0 }) as never);
  assertEquals(res.status, 400);
});

Deno.test("proposal-pbg-note - the PR can mark it paid; a converted EMD completes with it", async () => {
  const fake = client({ caller: await userRow("pr-1"), note: draft({ status: "pending_payment" }), fileCount: 1, track: "pbg" });
  const res = await handleRequest(req("pr-1", { action: "mark_paid", pin: PIN, payment_reference: "FDR 123" }), fake as never);
  assertEquals(res.status, 200);
  assertMatch(writesOf(fake, "proposal_pbg_notes")[0][1], /"status":"completed"/);
  assertMatch(writesOf(fake, "proposal_emd_tracking")[0][1], /"status":"completed"/);
});

// ── The calculation table ────────────────────────────────────────────
Deno.test("pbg table - EMD converted: remaining = PBG − EMD", () => {
  const rows = pbgCalculationRows({ pbgAmount: 197900, consultancyFee: 1979000, pbgPercent: "10", emdAmount: 69000, emdAdjusted: 69000, emdContext: "converted" });
  assertEquals(rows.map((r) => r[2]), ["1,97,900/-", "69,000/-", "1,28,900/-"]);
  assertMatch(rows[2][1], /One Lakh Twenty Eight Thousand Nine Hundred only/);
});

Deno.test("pbg table - EMD refunded: the full PBG", () => {
  const rows = pbgCalculationRows({ pbgAmount: 197900, consultancyFee: 1979000, pbgPercent: "10", emdAmount: 69000, emdAdjusted: 0, emdContext: "refunded" });
  assertEquals(rows.map((r) => r[2]), ["19,79,000/-", "1,97,900/-", "69,000/-", "1,97,900/-"]);
  assertMatch(rows[2][1], /refunded by the client/);
});

Deno.test("pbg note - the amounts pick the wording", () => {
  assertEquals(emdContextOf("pbg", 69000, 69000), "converted");
  assertEquals(emdContextOf("refund", 69000, 0), "refunded");
  assertEquals(emdContextOf("on_completion", 69000, 0), "on_completion");
  assertEquals(emdContextOf(null, 0, 0), "none");
});
