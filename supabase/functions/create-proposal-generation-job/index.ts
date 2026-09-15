// supabase/functions/create-proposal-generation-job/index.ts
// JWT must be ON. "Generate Final Proposal" — the ONLY write path onto
// proposal_generation_jobs (see 20260918000000_proposal_final_assembly.sql,
// which deliberately has no authenticated insert policy). Every selected
// document id is re-derived from its own source table, scoped to this
// proposal_id — the client can choose WHICH existing documents and in
// WHAT ORDER, but can never inject an arbitrary label/path, and can never
// reach into another proposal's documents by id. The actual DOCX->PDF
// conversion and PDF assembly happens out-of-band in the Dockerized
// proposal-worker, which polls this table for 'queued' rows.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

// Mirrors src/lib/proposalPrep.js's PROPOSAL_DOCUMENT_TYPES — kept in sync
// by hand since edge functions can't import frontend source. Only used to
// label the "document" source in the TOC/UI; the doc_type values
// themselves are the DB's own check constraint.
const PROPOSAL_DOCUMENT_LABELS: Record<string, string> = {
  technical: "Technical Proposal",
  financial: "Financial Proposal",
  proposal_3: "Proposal 3",
};

const SOURCE_TABLES: Record<string, string> = {
  ba: "proposal_document_requests",
  checklist: "proposal_afc_checklist_items",
  document: "proposal_documents",
};

// LibreOffice (via the worker) can open all of these; PDF passes through
// untouched. Matches the bucket's own allowed_mime_types.
const SUPPORTED_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx"]);

const MAX_ITEMS = 50;

function extOf(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName || "");
  return m ? m[1].toLowerCase() : "";
}

type SelectedItem = { source: string; source_id: string; label: string; file_name: string; file_path: string; ext: string };

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const proposalId = body.proposal_id;
  if (typeof proposalId !== "string" || !proposalId) return jsonRes(req, 400, { error: "proposal_id is required." });

  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return jsonRes(req, 400, { error: "Please select at least one document." });
  }
  if (rawItems.length > MAX_ITEMS) return jsonRes(req, 400, { error: `You can include at most ${MAX_ITEMS} documents in one proposal.` });

  try {
    const { data: proposal, error: proposalErr } = await adminClient
      .from("proposal_preparations")
      .select("id, lead_id, locked")
      .eq("id", proposalId)
      .maybeSingle();
    if (proposalErr || !proposal) return jsonRes(req, 404, { error: "Proposal not found." });

    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, submission_deadline, person_responsible_id, reviewer_id, approval_authority_id, title, client_name")
      .eq("id", proposal.lead_id)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    // Mirrors can_edit_proposal() exactly — see 20260820040000_proposal_preparation_schema.sql.
    const isPastDeadline = !!lead.submission_deadline && new Date(lead.submission_deadline) < new Date();
    const authorized = ["md", "admin"].includes(caller.role) ||
      [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "You do not have access to generate this proposal." });
    if (proposal.locked || isPastDeadline) {
      return jsonRes(req, 400, { error: "This proposal is locked and can no longer be generated." });
    }

    // Re-derive every item from its own source table, scoped to THIS
    // proposal_id — the only things trusted from the client are which
    // (source, source_id) pairs were picked and their order.
    const selected: SelectedItem[] = [];
    const seen = new Set<string>();
    for (const raw of rawItems) {
      if (typeof raw !== "object" || raw === null) return jsonRes(req, 400, { error: "Invalid document selection." });
      const source = (raw as Record<string, unknown>).source;
      const sourceId = (raw as Record<string, unknown>).source_id;
      if (typeof source !== "string" || !SOURCE_TABLES[source]) return jsonRes(req, 400, { error: "Invalid document source." });
      if (typeof sourceId !== "string" || !sourceId) return jsonRes(req, 400, { error: "Invalid document id." });
      const dedupeKey = `${source}:${sourceId}`;
      if (seen.has(dedupeKey)) return jsonRes(req, 400, { error: "The same document was selected more than once." });
      seen.add(dedupeKey);

      const table = SOURCE_TABLES[source];
      const { data: row, error: rowErr } = await adminClient
        .from(table)
        .select(source === "document" ? "id, doc_type, file_name, file_path" : "id, item_name, file_name, file_path")
        .eq("id", sourceId)
        .eq("proposal_id", proposalId)
        .maybeSingle();
      if (rowErr || !row) return jsonRes(req, 400, { error: "One of the selected documents no longer exists." });
      if (!row.file_path || !row.file_name) return jsonRes(req, 400, { error: "One of the selected documents has no file attached." });

      const ext = extOf(row.file_name as string);
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        return jsonRes(req, 400, { error: `"${row.file_name}" is a .${ext || "unknown"} file, which isn't supported for proposal generation.` });
      }

      const label = source === "document"
        ? (PROPOSAL_DOCUMENT_LABELS[row.doc_type as string] || (row.doc_type as string))
        : (row.item_name as string);

      selected.push({ source, source_id: sourceId, label, file_name: row.file_name as string, file_path: row.file_path as string, ext });
    }

    const { data: job, error: insertErr } = await adminClient
      .from("proposal_generation_jobs")
      .insert({
        proposal_id: proposalId,
        requested_by: caller.id,
        status: "queued",
        selected_items: selected,
      })
      .select("id")
      .single();
    if (insertErr) throw new Error(insertErr.message);

    return jsonRes(req, 200, { success: true, job_id: job.id });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
