import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const PR_ID = "pr-1";
const PROPOSAL_ID = "prop-1";

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1",
    submission_deadline: null,
    person_responsible_id: PR_ID,
    reviewer_id: "rev-1",
    approval_authority_id: "aa-1",
    title: "DPR for Smart City",
    client_name: "Smart City Corp",
    ...overrides,
  };
}

function client(opts: {
  caller?: Record<string, unknown>;
  proposal?: Record<string, unknown> | null;
  lead?: Record<string, unknown> | null;
  ba?: Record<string, unknown> | null;
  checklist?: Record<string, unknown> | null;
  document?: Record<string, unknown> | null;
  jobInsert?: Record<string, unknown> | null;
} = {}) {
  const proposal = opts.proposal === undefined ? { id: PROPOSAL_ID, lead_id: "lead-1", locked: false } : opts.proposal;
  const lead = opts.lead === undefined ? leadRow() : opts.lead;
  return createFakeAdminClient({
    afc_users: [{ data: opts.caller ?? { id: PR_ID, role: "project_officer", is_active: true, email: "pr@afc.com", pin_hash: null, teams: [] }, error: null }],
    proposal_preparations: [
      { data: proposal, error: null },
      { data: { id: "job-1" }, error: null }, // consumed if a test also queries this table again — unused normally
    ],
    leads: [{ data: lead, error: null }],
    proposal_document_requests: [{ data: opts.ba === undefined ? { id: "ba-1", item_name: "Company Profile", file_name: "profile.pdf", file_path: `${PROPOSAL_ID}/ba_request_ba-1.pdf` } : opts.ba, error: null }],
    proposal_afc_checklist_items: [{ data: opts.checklist === undefined ? { id: "check-1", item_name: "Internal Evaluation", file_name: "eval.docx", file_path: `${PROPOSAL_ID}/checklist_check-1.docx` } : opts.checklist, error: null }],
    proposal_documents: [{ data: opts.document === undefined ? { id: "doc-1", doc_type: "technical", file_name: "technical.docx", file_path: `${PROPOSAL_ID}/technical_doc-1.docx` } : opts.document, error: null }],
    proposal_generation_jobs: [{ data: opts.jobInsert === undefined ? { id: "job-1" } : opts.jobInsert, error: null }],
  });
}

function req(body: Record<string, unknown>, token = fakeJwt({ sub: PR_ID })) {
  return authedReq("https://x.com/create-proposal-generation-job", { token, body });
}

const oneItem = { proposal_id: PROPOSAL_ID, items: [{ source: "document", source_id: "doc-1" }] };

Deno.test("create-proposal-generation-job - OPTIONS returns ok without auth", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), client() as never);
  assertEquals(res.status, 200);
});

Deno.test("create-proposal-generation-job - non-POST is rejected", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "GET" }), client() as never);
  assertEquals(res.status, 405);
});

Deno.test("create-proposal-generation-job - missing proposal_id is rejected", async () => {
  const res = await handleRequest(req({ items: [{ source: "document", source_id: "doc-1" }] }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("create-proposal-generation-job - empty selection is rejected", async () => {
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, items: [] }), client() as never);
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "Please select at least one document.");
});

Deno.test("create-proposal-generation-job - proposal not found is a 404", async () => {
  const res = await handleRequest(req(oneItem), client({ proposal: null }) as never);
  assertEquals(res.status, 404);
});

Deno.test("create-proposal-generation-job - a caller not named on the lead (and not md/admin) is rejected", async () => {
  const res = await handleRequest(
    req(oneItem, fakeJwt({ sub: "outsider-1" })),
    client({ caller: { id: "outsider-1", role: "associate_consultant", is_active: true, email: "x@afc.com", pin_hash: null, teams: [] } }) as never,
  );
  assertEquals(res.status, 403);
});

Deno.test("create-proposal-generation-job - md is always authorized even if not named", async () => {
  const res = await handleRequest(
    req(oneItem, fakeJwt({ sub: "md-1" })),
    client({ caller: { id: "md-1", role: "md", is_active: true, email: "md@afc.com", pin_hash: null, teams: [] } }) as never,
  );
  assertEquals(res.status, 200);
});

Deno.test("create-proposal-generation-job - a locked proposal is rejected", async () => {
  const res = await handleRequest(req(oneItem), client({ proposal: { id: PROPOSAL_ID, lead_id: "lead-1", locked: true } }) as never);
  assertEquals(res.status, 400);
});

Deno.test("create-proposal-generation-job - past the submission deadline is rejected", async () => {
  const res = await handleRequest(req(oneItem), client({ lead: leadRow({ submission_deadline: "2000-01-01" }) }) as never);
  assertEquals(res.status, 400);
});

Deno.test("create-proposal-generation-job - a document that doesn't belong to this proposal is rejected", async () => {
  const res = await handleRequest(req(oneItem), client({ document: null }) as never);
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "One of the selected documents no longer exists.");
});

Deno.test("create-proposal-generation-job - a selected item with no file attached is rejected", async () => {
  const res = await handleRequest(req(oneItem), client({ document: { id: "doc-1", doc_type: "technical", file_name: null, file_path: null } }) as never);
  assertEquals(res.status, 400);
});

Deno.test("create-proposal-generation-job - an unsupported file type is rejected", async () => {
  const res = await handleRequest(
    req(oneItem),
    client({ document: { id: "doc-1", doc_type: "technical", file_name: "technical.zip", file_path: `${PROPOSAL_ID}/technical.zip` } }) as never,
  );
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, `"technical.zip" is a .zip file, which isn't supported for proposal generation.`);
});

Deno.test("create-proposal-generation-job - the same document selected twice is rejected", async () => {
  const res = await handleRequest(
    req({ proposal_id: PROPOSAL_ID, items: [{ source: "document", source_id: "doc-1" }, { source: "document", source_id: "doc-1" }] }),
    client() as never,
  );
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "The same document was selected more than once.");
});

Deno.test("create-proposal-generation-job - a bogus source is rejected", async () => {
  const res = await handleRequest(req({ proposal_id: PROPOSAL_ID, items: [{ source: "hacked", source_id: "doc-1" }] }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("create-proposal-generation-job - success: re-derives label/file_name/file_path server-side, preserves order, ignores any client-supplied fields", async () => {
  const fakeClient = client();
  const res = await handleRequest(
    req({
      proposal_id: PROPOSAL_ID,
      items: [
        { source: "document", source_id: "doc-1" },
        { source: "ba", source_id: "ba-1" },
        { source: "checklist", source_id: "check-1", label: "SPOOFED", file_path: "../../etc/passwd" },
      ],
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fakeClient as never,
  );
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.success, true);
  assertEquals(json.job_id, "job-1");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const log = (fakeClient as any).__log as { table: string; calls: string[][] }[];
  const insertCall = log.find((l) => l.table === "proposal_generation_jobs")?.calls.find((c) => c[0] === "insert");
  const inserted = JSON.parse(insertCall![1]);
  assertEquals(inserted.selected_items, [
    { source: "document", source_id: "doc-1", label: "Technical Proposal", file_name: "technical.docx", file_path: `${PROPOSAL_ID}/technical_doc-1.docx`, ext: "docx" },
    { source: "ba", source_id: "ba-1", label: "Company Profile", file_name: "profile.pdf", file_path: `${PROPOSAL_ID}/ba_request_ba-1.pdf`, ext: "pdf" },
    { source: "checklist", source_id: "check-1", label: "Internal Evaluation", file_name: "eval.docx", file_path: `${PROPOSAL_ID}/checklist_check-1.docx`, ext: "docx" },
  ]);
});
