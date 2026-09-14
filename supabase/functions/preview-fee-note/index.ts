// supabase/functions/preview-fee-note/index.ts
// JWT must be ON. Renders the Bid Payment Requisition Note PDF
// as base64 — the eye-icon "view" action in FeeNotesPanel, and also what
// FeeNotePinActionModal shows before a forward/approve is confirmed with a
// PIN. Read-only: no status change, no signature persisted. Access mirrors
// the existing authorized set for a proposal's fee notes (the lead's Person
// Responsible / Reviewer / Approval Authority, or md/admin) — the same PDF
// is shown at every stage, with signature slots filling in as the workflow
// progresses.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { bytesToBase64 } from "../_shared/letterPdf.ts";
import { buildFeeNotePdfForNote } from "../_shared/feeNotePdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

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

  const feeNoteId = body.fee_note_id;
  if (typeof feeNoteId !== "string" || !feeNoteId) return jsonRes(req, 400, { error: "fee_note_id is required." });

  try {
    const { data: note, error: noteErr } = await adminClient
      .from("fee_notes")
      .select("id, proposal_id")
      .eq("id", feeNoteId)
      .maybeSingle();
    if (noteErr || !note) return jsonRes(req, 404, { error: "Fee note not found." });

    const { data: proposal, error: propErr } = await adminClient
      .from("proposal_preparations")
      .select("lead_id")
      .eq("id", note.proposal_id)
      .maybeSingle();
    if (propErr || !proposal) return jsonRes(req, 404, { error: "Proposal not found." });

    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("person_responsible_id, reviewer_id, approval_authority_id")
      .eq("id", proposal.lead_id)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    const authorized =
      ["md", "admin"].includes(caller.role) ||
      [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this proposal." });

    const built = await buildFeeNotePdfForNote(adminClient, feeNoteId);
    if (!built.ok) return jsonRes(req, 500, { error: built.error });

    return jsonRes(req, 200, { success: true, pdf_base64: bytesToBase64(built.pdfBytes) });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
