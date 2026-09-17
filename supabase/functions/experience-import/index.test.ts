import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { createFakeAdminClient, FakeResult } from "../_shared/testHelpers.ts";

const SECRET = "test-shared-secret";
const CLIENT_ID = "experience-intelligence";
const AUDIENCE = "experience-import-gateway";

function base64Url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signServiceToken(
  opts: { clientId?: string; audience?: string; secret?: string; expiresInSeconds?: number } = {}
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: opts.clientId ?? CLIENT_ID,
    aud: opts.audience ?? AUDIENCE,
    iat: now,
    exp: now + (opts.expiresInSeconds ?? 300),
  };
  const headerB64 = base64Url(JSON.stringify(header));
  const payloadB64 = base64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(opts.secret ?? SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${sigB64}`;
}

function importReq(token: string, body: unknown): Request {
  return new Request("https://x.com/experience-import", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-client-id": CLIENT_ID },
    body: JSON.stringify(body),
  });
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "1.0",
    batch_id: "batch-1",
    initiated_by: "AUTO_IMPORT_HIGH_CONFIDENCE",
    projects: [
      {
        idempotency_key: "batch-1:Assignment-1",
        project_name: "National Level PACS Software Vendor",
        short_form: "PACS-SW",
        contract_value_crore: 32.01,
        country: "India",
        state_ut: "Maharashtra",
        client_type: "Government",
        project_status: "Ongoing",
        client_name: "NABARD",
        client_address: "Mumbai, Maharashtra",
        contact_person: "Mr. Sharma",
        designation: null,
        telephone: "022-12345678",
        email: null,
        start_date: "2021-09",
        completion_date: "Ongoing",
        duration_months: null,
        total_staff_months: null,
        professional_staff_months: null,
        associated_consultants: null,
        senior_professional_staff: null,
        project_description: "Nationwide ERP implementation for PACS digitization.",
        actual_services: "ERP design, development and rollout.",
        ai_search_summary: "Government ERP project for PACS digitization.",
        keywords: [{ keyword: "ERP", description: "Enterprise Resource Planning.", category: "Technology", aliases: [] }],
        source_assignment_number: "Assignment-1",
      },
    ],
    ...overrides,
  };
}

function buildClient(routes: Record<string, FakeResult[]> = {}) {
  const merged: Record<string, FakeResult[]> = {
    experience_import_ledger: [{ data: null, error: null }],
    keywords: [{ data: null, error: null }, { data: { id: "kw-1" }, error: null }],
    project_keyword_details: [{ data: {}, error: null }],
    application_audit_log: [{ data: {}, error: null }, { data: {}, error: null }],
    projects: [{ data: { id: "proj-1" }, error: null }],
    ...routes,
  };
  return createFakeAdminClient(merged);
}

Deno.test("GET returns health status without authentication", async () => {
  const res = await handleRequest(new Request("https://x.com/experience-import", { method: "GET" }), buildClient() as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.portal, true);
});

Deno.test("OPTIONS returns ok", async () => {
  const res = await handleRequest(new Request("https://x.com", { method: "OPTIONS" }), buildClient() as never);
  assertEquals(res.status, 200);
});

Deno.test("POST without a bearer token is rejected", async () => {
  const req = new Request("https://x.com/experience-import", {
    method: "POST",
    body: JSON.stringify(basePayload()),
  });
  const res = await handleRequest(req, buildClient() as never);
  assertEquals(res.status, 401);
});

Deno.test("POST with a token signed with the wrong secret is rejected", async () => {
  const token = await signServiceToken({ secret: "wrong-secret" });
  const res = await handleRequest(importReq(token, basePayload()), buildClient() as never);
  assertEquals(res.status, 401);
});

Deno.test("POST with an expired token is rejected", async () => {
  const token = await signServiceToken({ expiresInSeconds: -10 });
  const res = await handleRequest(importReq(token, basePayload()), buildClient() as never);
  assertEquals(res.status, 401);
});

Deno.test("POST with wrong audience is rejected", async () => {
  const token = await signServiceToken({ audience: "some-other-gateway" });
  const res = await handleRequest(importReq(token, basePayload()), buildClient() as never);
  assertEquals(res.status, 401);
});

Deno.test("POST with unsupported schema_version is rejected", async () => {
  const token = await signServiceToken();
  const res = await handleRequest(importReq(token, basePayload({ schema_version: "2.0" })), buildClient() as never);
  assertEquals(res.status, 422);
});

Deno.test("POST creates a project and returns status=created", async () => {
  const token = await signServiceToken();
  const client = buildClient();
  const res = await handleRequest(importReq(token, basePayload()), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.results.length, 1);
  assertEquals(body.results[0].status, "created");
  assertEquals(body.results[0].portal_project_id, "proj-1");

  // deno-lint-ignore no-explicit-any
  const projectInsertCall = (client as any).__log.find((l: any) => l.table === "projects").calls.find((c: string[]) => c[0] === "insert");
  const inserted = JSON.parse(projectInsertCall[1]);
  assertEquals(inserted.title, "National Level PACS Software Vendor");
  assertEquals(inserted.client, "NABARD, Mumbai, Maharashtra");
  assertEquals(inserted.client_type, "Government");
  assertEquals(inserted.status, "Ongoing");
  assertEquals(inserted.summary.experienceIntelligence.sourceAssignmentNumber, "Assignment-1");
});

Deno.test("POST sanitizes an out-of-enum client_type/status to null instead of failing", async () => {
  const token = await signServiceToken();
  const client = buildClient();
  const payload = basePayload({
    projects: [
      {
        ...basePayload().projects[0],
        client_type: "Multilateral",
        project_status: "Cancelled",
      },
    ],
  });
  const res = await handleRequest(importReq(token, payload), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.results[0].status, "created");

  // deno-lint-ignore no-explicit-any
  const projectInsertCall = (client as any).__log.find((l: any) => l.table === "projects").calls.find((c: string[]) => c[0] === "insert");
  const inserted = JSON.parse(projectInsertCall[1]);
  assertEquals(inserted.client_type, null);
  assertEquals(inserted.status, null);
});

Deno.test("POST with a missing required field returns a per-project error without touching projects table", async () => {
  const token = await signServiceToken();
  const client = buildClient();
  const payload = basePayload({
    projects: [{ ...basePayload().projects[0], project_name: "" }],
  });
  const res = await handleRequest(importReq(token, payload), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.results[0].status, "error");
  assertStringIncludes(body.results[0].error, "project_name");
});

Deno.test("POST replays an already-imported idempotency_key without creating a new project", async () => {
  const token = await signServiceToken();
  const client = buildClient({
    experience_import_ledger: [{ data: { project_id: "existing-proj" }, error: null }],
  });
  const res = await handleRequest(importReq(token, basePayload()), client as never);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.results[0].status, "created");
  assertEquals(body.results[0].portal_project_id, "existing-proj");

  // deno-lint-ignore no-explicit-any
  const projectsLog = (client as any).__log.filter((l: any) => l.table === "projects");
  assertEquals(projectsLog.length, 0);
});

Deno.test("POST continues processing remaining projects after one fails", async () => {
  const token = await signServiceToken();
  const client = buildClient();
  const payload = basePayload({
    projects: [
      { ...basePayload().projects[0], project_name: "" },
      { ...basePayload().projects[0], idempotency_key: "batch-1:Assignment-2" },
    ],
  });
  const res = await handleRequest(importReq(token, payload), client as never);
  const body = await res.json();
  assertEquals(body.results.length, 2);
  assertEquals(body.results[0].status, "error");
  assertEquals(body.results[1].status, "created");
});
