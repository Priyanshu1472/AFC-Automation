import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt, FakeResult } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const LEAD_ID = "lead-1";
const TEAM = "BPDD";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "project_officer", team: TEAM, office: "delhi", committee: null, is_active: true, email: "caller@afc.com", pin_hash: null, ...overrides };
}

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID, status: "pa_review", created_by: CALLER_ID, person_responsible_id: CALLER_ID,
    client_name: "A Client", submission_deadline: "2026-12-01", source: "in_house", lead_type: "rfp", ...overrides,
  };
}

// Every field validateRequired() checks for, filled in — the baseline for
// any test that needs to get past validation and reach the actual work.
// nature_of_lead is deliberately NOT here — it's derived server-side from
// the lead's own source/lead_type, never taken from the request body.
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    lead_id: LEAD_ID,
    client_address: "123 MG Road, Delhi",
    objectives: "Grow rural livelihoods.",
    scope_of_work: ["Step one", "Step two"],
    project_timeline: "6 months",
    justification: "Strong strategic fit for our BPDD pipeline.",
    scrutiny: Array.from({ length: 8 }, () => ({ yes_no: "Yes", remarks: "Confirmed." })),
    ...overrides,
  };
}

function buildClient(opts: {
  caller?: Record<string, unknown>;
  lead?: Record<string, unknown> | null;
  routes?: Record<string, FakeResult[]>;
}) {
  const routes: Record<string, FakeResult[]> = { ...(opts.routes || {}) };
  routes.afc_users = [{ data: opts.caller ?? callerRow(), error: null }, ...(routes.afc_users || [])];
  routes.leads = [{ data: opts.lead === undefined ? leadRow() : opts.lead, error: null }, ...(routes.leads || [])];
  return createFakeAdminClient(routes);
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/generate-lead-approval-note", { token: fakeJwt({ sub: CALLER_ID }), body });
}

function withFetch(impl: typeof fetch, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// A genuine, minimal 1x1 PNG — needed so pdf-lib's embedPng actually
// succeeds in the one full end-to-end success test below.
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const logoOkFetch = (() => {
  const bytes = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));
  return Promise.resolve(new Response(bytes, { status: 200 }));
}) as unknown as typeof fetch;
const logoFailsFetch = (() => Promise.resolve(new Response("not found", { status: 404 }))) as unknown as typeof fetch;

Deno.test("handleRequest - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient({}) as never);
  assertEquals(res.status, 200);
});

Deno.test("handleRequest - unauthenticated caller -> 401", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "POST" }), buildClient({}) as never);
  assertEquals(res.status, 401);
});

Deno.test("handleRequest - missing lead_id -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req({}), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - unknown lead -> 404", async () => {
  const client = buildClient({ lead: null });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 404);
});

Deno.test("handleRequest - rejects a caller who is neither creator nor Person Responsible", async () => {
  const client = buildClient({ lead: leadRow({ created_by: "someone-else", person_responsible_id: "someone-else-2" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 403);
});

Deno.test("handleRequest - rejects a lead that isn't pa_review or pa_action_required", async () => {
  const client = buildClient({ lead: leadRow({ status: "pmt_review" }) });
  const res = await handleRequest(req({ lead_id: LEAD_ID }), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - the Person Responsible (not creator) can generate the note", async () => {
  const client = buildClient({ lead: leadRow({ created_by: "someone-else", person_responsible_id: CALLER_ID }) });
  await withFetch(logoFailsFetch, async () => {
    const res = await handleRequest(req(validBody()), client as never);
    // Logo fetch fails in this test (no network access needed) -> the note
    // build fails gracefully with a 500, but this still proves the
    // permission check passed (a 403 would mean it never got this far).
    assertEquals(res.status, 500);
  });
});

// approval_note_pr_reviewed gates whether the PR's signature gets embedded
// on the PDF (see leadApprovalPdf.ts) — it must reflect who actually filled
// this form in, not just that a note now exists.
Deno.test("handleRequest - marks approval_note_pr_reviewed true when the Person Responsible generates the note", async () => {
  const client = buildClient({ lead: leadRow({ created_by: "someone-else", person_responsible_id: CALLER_ID }) });
  await withFetch(logoFailsFetch, async () => {
    await handleRequest(req(validBody()), client as never);
  });
  const leadsLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
  const updatedFields = JSON.parse(leadsLog[1].calls.find((c) => c[0] === "update")![1]);
  assertEquals(updatedFields.approval_note_pr_reviewed, true);
});

Deno.test("handleRequest - marks approval_note_pr_reviewed false when the creator (not PR) generates the note", async () => {
  const client = buildClient({ lead: leadRow({ created_by: CALLER_ID, person_responsible_id: "someone-else" }) });
  await withFetch(logoFailsFetch, async () => {
    await handleRequest(req(validBody()), client as never);
  });
  const leadsLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
  const updatedFields = JSON.parse(leadsLog[1].calls.find((c) => c[0] === "update")![1]);
  assertEquals(updatedFields.approval_note_pr_reviewed, false);
});

Deno.test("handleRequest - surfaces a clean error when the letterhead logo can't be loaded", async () => {
  const client = buildClient({});
  await withFetch(logoFailsFetch, async () => {
    const res = await handleRequest(req(validBody()), client as never);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, "Could not load the AFC letterhead logo.");
  });
});

Deno.test("handleRequest - scrutiny array entirely missing/malformed -> 400 (remarks are required per row)", async () => {
  const client = buildClient({});
  const res = await handleRequest(req(validBody({ scrutiny: "not-an-array" })), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - malformed yes_no on a scrutiny row falls back to defaults, remarks still required", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null },
      { data: { full_name: "Priya Sharma", role: "project_officer" }, error: null },
    ],
    leads: [
      { data: leadRow(), error: null },
      { data: {}, error: null },
      {
        data: {
          id: LEAD_ID, lead_number: "AFC/Lead/2026/001", title: "Test Lead", client_name: "A Client",
          submission_deadline: null, assigned_ba_id: null, person_responsible_id: CALLER_ID, team: TEAM,
          documents: [], approval_note_data: {},
        },
        error: null,
      },
      { data: {}, error: null },
    ],
    lead_activity_log: [{ data: [], error: null }],
  });

  await withFetch(logoOkFetch, async () => {
    const res = await handleRequest(
      req(validBody({ scrutiny: Array.from({ length: 8 }, () => ({ yes_no: "maybe", remarks: "Confirmed." })) })),
      client as never
    );
    assertEquals(res.status, 200);
  });
});

Deno.test("handleRequest - full success: saves approval_note_data, generates and stores the PDF", async () => {
  const client = createFakeAdminClient({
    afc_users: [
      { data: callerRow(), error: null }, // getCallerProfile
      { data: { full_name: "Priya Sharma", role: "project_officer" }, error: null }, // Person Responsible lookup
    ],
    leads: [
      { data: leadRow(), error: null }, // initial auth/status check
      { data: {}, error: null }, // approval_note_data update
      { // regenerateApprovalNote's own fresh fetch
        data: {
          id: LEAD_ID, lead_number: "AFC/Lead/2026/001", title: "Test Lead", status: "pa_review", client_name: "A Client",
          submission_deadline: null, assigned_ba_id: null, person_responsible_id: CALLER_ID, team: TEAM,
          documents: [], approval_note_data: { nature_of_lead: "Nomination" },
        },
        error: null,
      },
      { data: {}, error: null }, // documents write-back
    ],
    lead_activity_log: [{ data: [], error: null }],
  });

  await withFetch(logoOkFetch, async () => {
    const res = await handleRequest(req(validBody()), client as never);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    assertEquals(body.document.category, "approval_note");
    // Not yet actually submitted for DGM review (still pa_review) — the
    // single stored document is labeled "-- Draft" until "accept" moves it
    // to dgm_initial_review (see advance-lead-stage's REGENERATE_DRAFT_NOTE_ON).
    assertEquals(body.document.name, "Lead Approval Note -- Draft.pdf");
  });
});

// nature_of_lead is derived from the lead's own source/lead_type, ignoring
// whatever (if anything) the client sends for it — see deriveNatureOfLead.
for (
  const [source, leadType, expected] of [
    ["suo_moto", "rfp", "Suo Moto"],
    ["suo_moto", "eoi", "Suo Moto"],
    ["in_house", "rfp", "Tender"],
    ["ba", "rfp", "Tender"],
    ["in_house", "eoi", "Expression of Interest (EOI)"],
    ["ba", "eoi", "Expression of Interest (EOI)"],
  ] as const
) {
  Deno.test(`handleRequest - derives nature_of_lead "${expected}" for source=${source}/lead_type=${leadType}`, async () => {
    const client = buildClient({ lead: leadRow({ source, lead_type: leadType }) });
    await withFetch(logoFailsFetch, async () => {
      await handleRequest(req(validBody({ nature_of_lead: "Sneaky client-supplied value" })), client as never);
    });
    const leadsLog = (client as unknown as { __log: { table: string; calls: string[][] }[] }).__log.filter((l) => l.table === "leads");
    const updatedFields = JSON.parse(leadsLog[1].calls.find((c) => c[0] === "update")![1]);
    assertEquals(updatedFields.approval_note_data.nature_of_lead, expected);
  });
}

Deno.test("handleRequest - missing a required field (e.g. objectives) -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req(validBody({ objectives: "" })), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - empty scope_of_work array -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(req(validBody({ scope_of_work: [] })), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - non-numeric financial field -> 400", async () => {
  const client = buildClient({});
  const res = await handleRequest(
    req(validBody({ financial_requirement: { document_fee: "not-a-number" } })),
    client as never
  );
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - blank financial fields are fine (optional)", async () => {
  const client = buildClient({});
  await withFetch(logoOkFetch, async () => {
    const res = await handleRequest(
      req(validBody({ financial_requirement: { document_fee: "", pbg: "", emd: "", processing_fee: "" } })),
      client as never
    );
    assertEquals(res.status, 200);
  });
});

Deno.test("handleRequest - lead missing client_name -> 400", async () => {
  const client = buildClient({ lead: leadRow({ client_name: null }) });
  const res = await handleRequest(req(validBody()), client as never);
  assertEquals(res.status, 400);
});

Deno.test("handleRequest - lead missing submission_deadline -> 400", async () => {
  const client = buildClient({ lead: leadRow({ submission_deadline: null }) });
  const res = await handleRequest(req(validBody()), client as never);
  assertEquals(res.status, 400);
});
