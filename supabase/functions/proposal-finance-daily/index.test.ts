import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleRequest, istDate } from "./index.ts";
import { createFakeAdminClient, type FakeResult } from "../_shared/testHelpers.ts";

const LEAD = { id: "lead-1", lead_number: "L-1", title: "CAT Plan", person_responsible_id: "pr-1", reviewer_id: "rev-1", recommending_authority_id: "ra-1" };

function client(opts: { deadline: string | null; proofs?: number; remindedOn?: string | null; emailed?: string | null }) {
  const routes: Record<string, FakeResult[]> = {
    fee_notes: [{ data: [{ id: "fn-1", proposal_id: "prop-1", proof_reminded_on: opts.remindedOn ?? null, proof_deadline_emailed_at: opts.emailed ?? null }], error: null }],
    afc_user_committees: [{ data: [{ user_id: "acc-1" }], error: null }],
    afc_users: [{ data: [{ id: "acc-1" }], error: null }, { data: { email: "x@afc.com" }, error: null }],
    proposal_finance_files: [{ data: null, error: null, count: opts.proofs ?? 0 }],
    proposal_preparations: [{ data: { lead_id: "lead-1" }, error: null }],
    leads: [{ data: { ...LEAD, submission_deadline: opts.deadline }, error: null }],
    proposal_additional_responsibles: [{ data: [], error: null }],
  };
  return createFakeAdminClient(routes);
}

const req = (secret = "s3cret") => new Request("https://x.com/proposal-finance-daily", { method: "POST", headers: { "x-cron-secret": secret } });
const NOW = new Date("2026-11-18T05:00:00Z"); // 18 Nov, 10:30 IST

Deno.env.set("CRON_SECRET", "s3cret");

Deno.test("proposal-finance-daily - wrong secret is refused", async () => {
  const res = await handleRequest(req("nope"), client({ deadline: null }) as never, NOW);
  assertEquals(res.status, 401);
});

Deno.test("proposal-finance-daily - daily in-app reminder before the submission date", async () => {
  const fake = client({ deadline: "2026-11-25" });
  const res = await handleRequest(req(), fake as never, NOW);
  assertEquals(await res.json(), { success: true, reminded: 1, emailed: 0 });
  const insert = fake.__log.filter((l) => l.table === "notifications").flatMap((l) => l.calls).find((c) => c[0] === "insert");
  assertMatch(insert![1], /"user_id":"acc-1"/);
  assertMatch(insert![1], /"user_id":"pr-1"/);
});

Deno.test("proposal-finance-daily - not twice on the same day", async () => {
  const res = await handleRequest(req(), client({ deadline: "2026-11-25", remindedOn: istDate(NOW) }) as never, NOW);
  assertEquals(await res.json(), { success: true, reminded: 0, emailed: 0 });
});

Deno.test("proposal-finance-daily - nothing once a proof is uploaded", async () => {
  const res = await handleRequest(req(), client({ deadline: "2026-11-25", proofs: 1 }) as never, NOW);
  assertEquals(await res.json(), { success: true, reminded: 0, emailed: 0 });
});

Deno.test("proposal-finance-daily - one email on the submission date", async () => {
  const res = await handleRequest(req(), client({ deadline: "2026-11-18" }) as never, NOW);
  assertEquals(await res.json(), { success: true, reminded: 0, emailed: 1 });
  const again = await handleRequest(req(), client({ deadline: "2026-11-18", emailed: "2026-11-18T04:00:00Z" }) as never, NOW);
  assertEquals(await again.json(), { success: true, reminded: 0, emailed: 0 });
});
