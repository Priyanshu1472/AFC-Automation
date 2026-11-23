// supabase/functions/preview-pbg-note/index.ts
// JWT must be ON. Renders the PBG Note PDF as base64 — "Create / View PBG
// Note" on the proposal page. Read-only. Any internal (non-Business
// Partner) user can view it, org-wide — same rule as can_view_lead()'s
// md_approved clause (see 20261117010000_org_wide_internal_proposal_
// view.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { moduleOffResponse } from "../_shared/modules.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { bytesToBase64 } from "../_shared/letterPdf.ts";
import { buildPbgNotePdf } from "../_shared/pbgNotePdf.ts";
import { isInternalRole, loadProposalAndLead } from "../_shared/proposalFinance.ts";

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  const moduleOff = await moduleOffResponse(req, "proposals");
  if (moduleOff) return moduleOff;
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

  try {
    const ctx = await loadProposalAndLead(adminClient, proposalId);
    if (!ctx.ok) return jsonRes(req, ctx.status, { error: ctx.error });

    if (!isInternalRole(caller)) return jsonRes(req, 403, { error: "You do not have access to this proposal." });

    const built = await buildPbgNotePdf(adminClient, proposalId);
    if (!built.ok) return jsonRes(req, 400, { error: built.error });

    return jsonRes(req, 200, { success: true, pdf_base64: bytesToBase64(built.pdfBytes) });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
