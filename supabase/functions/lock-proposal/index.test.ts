import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

function client(opts: { note?: unknown; docs?: number; value?: number | null }) {
  return createFakeAdminClient({
    afc_users: [{ data: { id: "pr-1", role: "project_officer", is_active: true, email: "pr@afc.com" }, error: null }],
    proposal_preparations: [
      { data: { id: "prop-1", lead_id: "lead-1", locked: false, proposed_value: opts.value === undefined ? 2500000 : opts.value }, error: null },
      { data: null, error: null },
    ],
    fee_notes: [{ data: opts.note === undefined ? { id: "fee-1" } : opts.note, error: null }],
    proposal_documents: [{ data: null, error: null, count: opts.docs ?? 1 }],
    leads: [{ data: { person_responsible_id: "pr-1", reviewer_id: "rev-1", recommending_authority_id: "ra-1" }, error: null }],
  });
}
const req = () => authedReq("https://x.com/lock-proposal", { token: fakeJwt({ sub: "pr-1" }), body: { proposal_id: "prop-1" } });

Deno.test("lock-proposal - needs the approved Bid Payment Requisition Note", async () => {
  const res = await handleRequest(req(), client({ note: null }) as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.includes("Bid Payment Requisition Note"), true);
});

Deno.test("lock-proposal - needs the proposal documents", async () => {
  const res = await handleRequest(req(), client({ docs: 0 }) as never);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.includes("proposal documents"), true);
});

Deno.test("lock-proposal - needs the proposed value", async () => {
  const res = await handleRequest(req(), client({ value: null }) as never);
  assertEquals(res.status, 400);
});

Deno.test("lock-proposal - locks when everything is in place", async () => {
  const res = await handleRequest(req(), client({}) as never);
  assertEquals(res.status, 200);
});
