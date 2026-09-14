import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "pr-1";
const FEE_NOTE_ID = "fee-1";
const PROPOSAL_ID = "prop-1";
const LEAD_ID = "lead-1";

// A real (tiny, valid) 1x1 PNG — pdf-lib actually parses the logo bytes.
const MINIMAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
function pngBytes(): Uint8Array {
  const bin = atob(MINIMAL_PNG_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// The note PDF is set in the standard Times-Roman (no embedded font), so
// the only asset fetched is the letterhead logo — stub it with a real 1x1
// PNG that pdf-lib can actually parse.
function withStubbedAssetFetch<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(pngBytes(), { status: 200 }))) as unknown as typeof fetch;
  return run().finally(() => { globalThis.fetch = original; });
}

function noteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FEE_NOTE_ID, proposal_id: PROPOSAL_ID,
    emd_amount: 200000, emd_borne_by: "afc", emd_payment_mode: "demand_draft",
    emd_dd_in_favour_of: "Additional PCCF, CAMPA, Jharkhand", emd_dd_payable_at: "Ranchi",
    tender_fee_amount: null, tender_fee_borne_by: "afc", tender_fee_payment_mode: null,
    tender_fee_dd_in_favour_of: null, tender_fee_dd_payable_at: null,
    processing_fee_amount: 5000, processing_fee_borne_by: "afc", processing_fee_payment_mode: "bank_guarantee",
    processing_fee_dd_in_favour_of: "Additional PCCF, CAMPA, Jharkhand", processing_fee_dd_payable_at: "Ranchi",
    justification: "Required for bid", status: "draft", submit_to: "APCCF & CEO, CAMPA",
    client_address: "Van Bhawan, Doranda, Ranchi", client_telephone: "0651-2410007", client_email: "apccf-campa@gov.in",
    implementation_arrangements: null, created_by: CALLER_ID,
    pr_signed_by: null, pr_signed_at: null, aa_signed_by: null, aa_signed_at: null, md_decided_by: null, md_decided_at: null,
    ...overrides,
  };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    title: "DPR for Smart City", client_name: "Municipal Corp", portal_name: "GeM (Government e-Marketplace)",
    bid_number: "BID/123", lead_type: "rfp", delivery_type: "offline", submission_deadline: "2026-07-02",
    source: "in_house", assigned_ba_id: null,
    person_responsible_id: CALLER_ID, reviewer_id: "reviewer-1", approval_authority_id: "aa-1",
    approval_note_data: { client_address: "Van Bhawan", objectives: "Evaluate works", scope_of_work: ["10% sampling", "Field visits"] },
    ...overrides,
  };
}

function client(opts: { caller?: Record<string, unknown>; note?: Record<string, unknown> | null; lead?: Record<string, unknown> | null } = {}) {
  const note = opts.note === undefined ? noteRow() : opts.note;
  const lead = opts.lead === undefined ? leadRow() : opts.lead;
  return createFakeAdminClient({
    afc_users: [
      { data: opts.caller ?? { id: CALLER_ID, role: "project_officer", is_active: true, email: "pr@afc.com" }, error: null },
      { data: { full_name: "Person Responsible Name", role: "project_officer", signature_path: null }, error: null },
      { data: { full_name: "Approval Authority Name", role: "dgm", signature_path: null }, error: null },
      { data: { full_name: "Preparer Name", role: "project_assistant", signature_path: null }, error: null },
    ],
    fee_notes: [{ data: note, error: null }, { data: note, error: null }],
    proposal_preparations: [{ data: { lead_id: LEAD_ID }, error: null }, { data: { lead_id: LEAD_ID }, error: null }],
    leads: [{ data: lead, error: null }, { data: lead, error: null }],
  });
}

function req(body: Record<string, unknown>, token = fakeJwt({ sub: CALLER_ID })) {
  return authedReq("https://x.com/preview-fee-note", { token, body });
}

Deno.test("preview-fee-note - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), client() as never);
  assertEquals(res.status, 200);
});

Deno.test("preview-fee-note - non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), client() as never);
  assertEquals(res.status, 405);
});

Deno.test("preview-fee-note - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST", body: JSON.stringify({}) }), client() as never);
  assertEquals(res.status, 401);
});

Deno.test("preview-fee-note - fee_note_id is required", async () => {
  const res = await handleRequest(req({}), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("preview-fee-note - a caller with no relation to the lead is forbidden", async () => {
  const res = await handleRequest(
    req({ fee_note_id: FEE_NOTE_ID }, fakeJwt({ sub: "stranger-1" })),
    client({ caller: { id: "stranger-1", role: "project_officer", is_active: true, email: "x@afc.com" } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("preview-fee-note - Person Responsible can preview and gets a PDF", async () => {
  await withStubbedAssetFetch(async () => {
    const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID }), client() as never);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(typeof json.pdf_base64, "string");
  });
});

Deno.test("preview-fee-note - md/admin can preview even without being named on the lead", async () => {
  await withStubbedAssetFetch(async () => {
    const res = await handleRequest(
      req({ fee_note_id: FEE_NOTE_ID }, fakeJwt({ sub: "md-1" })),
      client({ caller: { id: "md-1", role: "md", is_active: true, email: "md@afc.com" } }) as never,
    );
    assertEquals(res.status, 200);
  });
});

Deno.test("preview-fee-note - logo fetch failure surfaces a clean 500", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("not found", { status: 404 }))) as unknown as typeof fetch;
  try {
    const res = await handleRequest(req({ fee_note_id: FEE_NOTE_ID }), client() as never);
    const json = await res.json();
    assertEquals(res.status, 500);
    assertEquals(json.error, "Could not load the AFC letterhead logo. Please try again.");
  } finally {
    globalThis.fetch = original;
  }
});
