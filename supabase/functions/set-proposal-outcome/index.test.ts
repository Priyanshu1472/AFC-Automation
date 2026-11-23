import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

type Opts = { caller?: string; leadType?: string; source?: string; empanelmentOnly?: boolean; additional?: string[]; locked?: boolean };

function client(opts: Opts = {}) {
  return createFakeAdminClient({
    afc_users: [{ data: { id: opts.caller ?? "pr-1", role: "project_officer", is_active: true, email: "pr@afc.com" }, error: null }],
    proposal_preparations: [
      { data: { id: "prop-1", lead_id: "lead-1", locked: opts.locked ?? true, client_response: "pending", empanelment_only: !!opts.empanelmentOnly }, error: null },
      { data: null, error: null },
    ],
    leads: [{
      data: {
        id: "lead-1", lead_number: "L-1", title: "Test", person_responsible_id: "pr-1", reviewer_id: "rev-1", recommending_authority_id: "ra-1",
        lead_type: opts.leadType ?? "rfp", source: opts.source ?? "in_house",
      },
      error: null,
    }],
    proposal_additional_responsibles: [{ data: (opts.additional ?? []).map((user_id) => ({ user_id })), error: null }],
    fee_notes: [{ data: null, error: null }],
  });
}

const req = (body: Record<string, unknown>, sub = "pr-1") =>
  authedReq("https://x.com/set-proposal-outcome", { token: fakeJwt({ sub }), body: { proposal_id: "prop-1", ...body } });

function updateOf(c: ReturnType<typeof createFakeAdminClient>) {
  const entry = c.__log.filter((l: { table: string; calls: string[][] }) => l.table === "proposal_preparations").find((l: { table: string; calls: string[][] }) => l.calls.some((call) => call[0] === "update"));
  const call = entry?.calls.find((call) => call[0] === "update");
  return call ? JSON.parse(call[1]) : null;
}

Deno.test("set-proposal-outcome - the Reviewer can record the result", async () => {
  const c = client({ caller: "rev-1" });
  const res = await handleRequest(req({ outcome: "rejected" }, "rev-1"), c as never);
  assertEquals(res.status, 200);
});

Deno.test("set-proposal-outcome - an additional Person Responsible can record the result", async () => {
  const c = client({ caller: "apr-1", additional: ["apr-1"] });
  const res = await handleRequest(req({ outcome: "rejected" }, "apr-1"), c as never);
  assertEquals(res.status, 200);
});

Deno.test("set-proposal-outcome - someone outside the team can't", async () => {
  const c = client({ caller: "x-1" });
  const res = await handleRequest(req({ outcome: "awarded" }, "x-1"), c as never);
  assertEquals(res.status, 403);
});

Deno.test("set-proposal-outcome - an RFP award is a project award", async () => {
  const c = client();
  const res = await handleRequest(req({ outcome: "awarded" }), c as never);
  assertEquals(res.status, 200);
  assertEquals(updateOf(c)?.award_kind, "project");
});

Deno.test("set-proposal-outcome - an EOI award must say project or next stage", async () => {
  const res = await handleRequest(req({ outcome: "awarded" }), client({ leadType: "eoi" }) as never);
  assertEquals(res.status, 400);
});

Deno.test("set-proposal-outcome - an EOI can move to the RFP / tender stage", async () => {
  const c = client({ leadType: "eoi" });
  const res = await handleRequest(req({ outcome: "awarded", award_kind: "next_stage" }), c as never);
  assertEquals(res.status, 200);
  assertEquals(updateOf(c)?.award_kind, "next_stage");
});

Deno.test("set-proposal-outcome - an empanelment-only award is recorded as empanelled", async () => {
  const c = client({ empanelmentOnly: true });
  const res = await handleRequest(req({ outcome: "awarded", award_kind: "project" }), c as never);
  assertEquals(res.status, 200);
  assertEquals(updateOf(c)?.award_kind, "empanelled");
});

Deno.test("set-proposal-outcome - needs the proposal locked first", async () => {
  const res = await handleRequest(req({ outcome: "rejected" }), client({ locked: false }) as never);
  assertEquals(res.status, 400);
});
