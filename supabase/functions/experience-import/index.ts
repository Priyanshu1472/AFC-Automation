// supabase/functions/experience-import/index.ts
// The "Experience Import Gateway" — the ONLY endpoint the Experience
// Intelligence application (a separate local AI app) is allowed to call.
// It never receives a Supabase key and never touches this database
// directly; it sends already-reviewed, human-approved project data here
// over HTTPS with a short-lived signed service token (see
// _shared/serviceAuth.ts), and this function performs the actual writes
// using the same `projects`/`keywords`/`project_keyword_details` tables
// AddProjectPage.jsx already uses — so AI-imported and manually-added
// projects are indistinguishable to the rest of the app.
//
// Contract: experience-intelligence/docs/portal-integration.md in that
// repo. Schema version handled: "1.0".
//
// What this function deliberately does NOT do:
//   - Compute the project_experience_embeddings row (that requires the
//     in-browser transformers.js model — see src/lib/embeddingModel.js).
//     After a bulk import, run the existing "Rebuild Index" admin action
//     (RebuildIndexPanel.jsx / bulkReindexAll) once to backfill semantic
//     search for newly imported projects.
//   - Attach source documents (Experience Intelligence's payload is
//     metadata-only; document attachment can be added later if needed).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/auth.ts";
import { verifyServiceToken } from "../_shared/serviceAuth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const EXPECTED_AUDIENCE = "experience-import-gateway";
const SUPPORTED_SCHEMA_VERSION = "1.0";
const ALLOWED_CLIENT_TYPES = new Set(["Government", "Private"]);
const ALLOWED_STATUSES = new Set(["Ongoing", "Completed"]);

interface PortalKeywordPayload {
  keyword: string;
  description?: string | null;
  category?: string | null;
  aliases?: string[];
}

interface PortalProjectPayload {
  idempotency_key: string;
  project_name: string | null;
  short_form?: string | null;
  contract_value_crore?: number | null;
  country?: string | null;
  state_ut?: string | null;
  client_type?: string | null;
  project_status?: string | null;
  client_name?: string | null;
  client_address?: string | null;
  contact_person?: string | null;
  designation?: string | null;
  telephone?: string | null;
  email?: string | null;
  start_date?: string | null;
  completion_date?: string | null;
  duration_months?: number | null;
  total_staff_months?: number | null;
  professional_staff_months?: number | null;
  associated_consultants?: string | null;
  senior_professional_staff?: string | null;
  project_description?: string | null;
  actual_services?: string | null;
  ai_search_summary?: string | null;
  keywords?: PortalKeywordPayload[];
  source_assignment_number?: string | null;
}

interface PortalImportPayload {
  schema_version: string;
  batch_id: string;
  initiated_by: string;
  projects: PortalProjectPayload[];
}

interface PortalProjectResult {
  idempotency_key: string;
  status: "created" | "duplicate" | "error";
  portal_project_id: string | null;
  error: string | null;
}

function sanitizeEnum(value: string | null | undefined, allowed: Set<string>): string | null {
  return value && allowed.has(value) ? value : null;
}

function validatePayload(payload: unknown): { error: string } | { value: PortalImportPayload } {
  if (typeof payload !== "object" || payload === null) return { error: "Request body must be a JSON object." };
  const p = payload as Record<string, unknown>;
  if (p.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    return { error: `Unsupported schema_version. Expected "${SUPPORTED_SCHEMA_VERSION}".` };
  }
  if (typeof p.batch_id !== "string" || !p.batch_id) return { error: "batch_id is required." };
  if (typeof p.initiated_by !== "string" || !p.initiated_by) return { error: "initiated_by is required." };
  if (!Array.isArray(p.projects) || p.projects.length === 0) return { error: "projects must be a non-empty array." };
  return { value: p as unknown as PortalImportPayload };
}

function validateProject(project: PortalProjectPayload): string | null {
  if (!project.idempotency_key || typeof project.idempotency_key !== "string") {
    return "idempotency_key is required.";
  }
  if (!project.project_name || !project.project_name.trim()) return "project_name is required.";
  if (!project.client_name || !project.client_name.trim()) return "client_name is required.";
  if (project.contract_value_crore != null && project.contract_value_crore < 0) {
    return "contract_value_crore cannot be negative.";
  }
  if (project.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(project.email)) {
    return "email format is invalid.";
  }
  return null;
}

async function findOrCreateKeyword(admin: AdminClient, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data: existing } = await admin.from("keywords").select("id").eq("name", trimmed).maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created, error } = await admin.from("keywords").insert({ name: trimmed }).select("id").single();
  if (error || !created) {
    // Race with another concurrent insert of the same keyword name (unique
    // constraint) — re-select rather than failing the whole project.
    const { data: retry } = await admin.from("keywords").select("id").eq("name", trimmed).maybeSingle();
    return (retry?.id as string) ?? null;
  }
  return created.id as string;
}

async function importOneProject(
  admin: AdminClient,
  project: PortalProjectPayload,
  batchId: string,
  initiatedBy: string
): Promise<PortalProjectResult> {
  const fieldError = validateProject(project);
  if (fieldError) {
    return { idempotency_key: project.idempotency_key, status: "error", portal_project_id: null, error: fieldError };
  }

  // --- Idempotency: a repeated key returns the original result, never a
  // second project. ---
  const { data: existingLedgerRow } = await admin
    .from("experience_import_ledger")
    .select("project_id")
    .eq("idempotency_key", project.idempotency_key)
    .maybeSingle();
  if (existingLedgerRow?.project_id) {
    return {
      idempotency_key: project.idempotency_key,
      status: "created",
      portal_project_id: existingLedgerRow.project_id as string,
      error: null,
    };
  }

  const client = [project.client_name?.trim(), project.client_address?.trim()].filter(Boolean).join(", ") || null;

  const summary = {
    servicesDescription: project.actual_services ?? null,
    capitalCost: project.contract_value_crore ?? null,
    country: project.country ?? null,
    contactPerson: project.contact_person ?? null,
    titleDesignation: project.designation ?? null,
    telephone: project.telephone ?? null,
    email: project.email ?? null,
    associatedConsultants: project.associated_consultants ?? null,
    startDate: project.start_date ?? null,
    finishDate: project.completion_date ?? null,
    projectBriefDescription: project.project_description ?? null,
    totalStaffMonths: project.total_staff_months ?? null,
    associatedConsultantMonths: project.professional_staff_months ?? null,
    seniorProfessionalStaff: project.senior_professional_staff ?? null,
    // Traceability back to the AI import — not read by AddProjectPage/UI
    // today, kept for reference and future use (e.g. showing an "AI
    // Imported" badge or the AI search summary on the project detail page).
    experienceIntelligence: {
      batchId,
      idempotencyKey: project.idempotency_key,
      sourceAssignmentNumber: project.source_assignment_number ?? null,
      aiSearchSummary: project.ai_search_summary ?? null,
      importedBy: initiatedBy,
      importedAt: new Date().toISOString(),
    },
  };

  const { data: inserted, error: insertErr } = await admin
    .from("projects")
    .insert({
      title: project.project_name!.trim(),
      shortform: project.short_form || null,
      client,
      location: project.state_ut || null,
      client_type: sanitizeEnum(project.client_type, ALLOWED_CLIENT_TYPES),
      status: sanitizeEnum(project.project_status, ALLOWED_STATUSES),
      summary,
      created_by: null,
      team: null,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return {
      idempotency_key: project.idempotency_key,
      status: "error",
      portal_project_id: null,
      error: insertErr?.message || "Failed to create project.",
    };
  }
  const projectId = inserted.id as string;

  for (const kw of project.keywords ?? []) {
    if (!kw.keyword?.trim()) continue;
    const keywordId = await findOrCreateKeyword(admin, kw.keyword);
    if (!keywordId) continue;
    await admin
      .from("project_keyword_details")
      .insert({ project_id: projectId, keyword_id: keywordId, description: kw.description ?? null })
      .then(({ error }) => {
        // Duplicate (project_id, keyword_id) — harmless, ignore.
        if (error && !error.message?.includes("duplicate")) {
          console.error("Keyword attach failed:", error.message);
        }
      });
  }

  await admin.from("experience_import_ledger").insert({
    idempotency_key: project.idempotency_key,
    project_id: projectId,
    batch_id: batchId,
    initiated_by: initiatedBy,
  });

  await admin.from("application_audit_log").insert({
    action: "experience_intelligence_import",
    action_by: null,
    action_by_role: "experience-intelligence-service",
    comment: `Project "${project.project_name}" imported into the Knowledge Repository from Experience Intelligence ` +
      `(batch ${batchId}, ${project.source_assignment_number ?? "no assignment number"}), initiated by ${initiatedBy}.`,
  });

  return { idempotency_key: project.idempotency_key, status: "created", portal_project_id: projectId, error: null };
}

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });

  if (req.method === "GET") {
    // Unauthenticated liveness ping only — no data returned. Matches
    // PORTAL_HEALTH_URL in Experience Intelligence's settings.
    return jsonRes(req, 200, { portal: true, service: "experience-import-gateway" });
  }

  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const secret = Deno.env.get("EXPERIENCE_IMPORT_SECRET");
  const expectedClientId = Deno.env.get("EXPERIENCE_IMPORT_CLIENT_ID") || "experience-intelligence";
  if (!secret) {
    console.error("EXPERIENCE_IMPORT_SECRET is not configured.");
    return jsonRes(req, 500, { error: "Import gateway is not configured." });
  }

  const authResult = await verifyServiceToken(req, secret, EXPECTED_AUDIENCE, expectedClientId);
  if (!authResult.ok) return jsonRes(req, authResult.status, { error: authResult.error });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const validated = validatePayload(body);
  if ("error" in validated) return jsonRes(req, 422, { error: validated.error });
  const payload = validated.value;

  const results: PortalProjectResult[] = [];
  for (const project of payload.projects) {
    try {
      results.push(await importOneProject(adminClient, project, payload.batch_id, payload.initiated_by));
    } catch (err) {
      console.error("Unhandled error importing project:", (err as Error).message);
      results.push({
        idempotency_key: project?.idempotency_key ?? "unknown",
        status: "error",
        portal_project_id: null,
        error: "Internal server error while importing this project.",
      });
    }
  }

  const succeeded = results.filter((r) => r.status !== "error").length;
  await adminClient.from("application_audit_log").insert({
    action: "experience_intelligence_batch_import",
    action_by: null,
    action_by_role: "experience-intelligence-service",
    comment: `Experience Intelligence batch ${payload.batch_id}: ${succeeded}/${results.length} projects imported, initiated by ${payload.initiated_by}.`,
  }).then(({ error }) => {
    if (error) console.error("Batch audit log failed:", error.message);
  });

  return jsonRes(req, 200, { batch_id: payload.batch_id, results });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
