// supabase/functions/get-user-signature-url/index.ts
// JWT must be ON. Signs a short-lived URL for a staff member's signature
// image in the private user-signatures bucket — Admin can view anyone's (to
// preview it on the Edit User page), and every user can view their own (on
// My Profile), but never someone else's. Near-copy of
// get-lead-document-url's shape.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const BUCKET = "user-signatures";
const SIGNED_URL_TTL_SECONDS = 5 * 60;

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

  const { user_id } = body;
  if (!user_id || typeof user_id !== "string") return jsonRes(req, 400, { error: "user_id is required." });
  if (caller.role !== "admin" && caller.id !== user_id) {
    return jsonRes(req, 403, { error: "You can only view your own signature." });
  }

  const { data: target, error: targetErr } = await adminClient
    .from("afc_users")
    .select("id, signature_path")
    .eq("id", user_id)
    .maybeSingle();
  if (targetErr || !target) return jsonRes(req, 404, { error: "User not found." });
  if (!target.signature_path) return jsonRes(req, 404, { error: "This user has no signature on file." });

  // Signature objects are always stored under `${user_id}/...` — reject
  // anything else as a defense-in-depth check against a corrupted path.
  if (!target.signature_path.startsWith(`${user_id}/`)) {
    return jsonRes(req, 400, { error: "Signature path is invalid." });
  }

  const { data: signed, error: signErr } = await adminClient.storage.from(BUCKET).createSignedUrl(target.signature_path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed) return jsonRes(req, 500, { error: "Failed to generate signature link." });

  return jsonRes(req, 200, { url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
