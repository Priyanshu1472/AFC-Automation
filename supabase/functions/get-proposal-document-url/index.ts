// supabase/functions/get-proposal-document-url/index.ts
// JWT must be ON. Re-verifies the caller can access this specific proposal
// before signing a short-lived URL for a file in the private
// proposal-documents bucket — the bucket has no client-facing SELECT
// policy at all (see 20260820040000_proposal_preparation_schema.sql). Uses
// its own narrow check (md/admin, or this proposal's own named Person
// Responsible/Reviewer/Recommending Authority) — deliberately NOT the
// broad canViewLead() (which now also grants every DGM/AGM/PMT member
// access to the underlying lead, per 20260928000200): Proposal
// Preparation's own visibility stayed narrow on purpose (see
// 20260910001000_narrow_md_approved_lead_visibility.sql and
// can_edit_proposal()/canOpenProposal() elsewhere), and this document URL
// signer needs to match those, not the lead's own broader rule.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

const BUCKET = "proposal-documents";
const SIGNED_URL_TTL_SECONDS = 5 * 60;

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
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

  const { path, proposal_id: proposalId } = body;
  if (!path || typeof path !== "string") return jsonRes(req, 400, { error: "path is required." });
  if (!proposalId || typeof proposalId !== "string") return jsonRes(req, 400, { error: "proposal_id is required." });
  if (!path.startsWith(`${proposalId}/`)) return jsonRes(req, 403, { error: "You do not have access to this document." });

  const { data: proposal } = await adminClient
    .from("proposal_preparations")
    .select("id, lead_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal) return jsonRes(req, 404, { error: "Proposal not found." });

  const { data: lead } = await adminClient
    .from("leads")
    .select("person_responsible_id, reviewer_id, recommending_authority_id")
    .eq("id", proposal.lead_id)
    .maybeSingle();
  if (!lead) return jsonRes(req, 404, { error: "Lead not found." });

  const authorized =
    ["md", "admin"].includes(caller.role) ||
    [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(caller.id);
  if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this document." });

  const { data: signed, error: signErr } = await adminClient.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed) return jsonRes(req, 500, { error: "Failed to generate document link." });

  return jsonRes(req, 200, { url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
