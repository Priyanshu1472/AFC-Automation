// supabase/functions/check-reset-email/index.ts
// JWT verification must be OFF (public — called from the Forgot Password
// page before sign-in). Supabase Auth's own /recover endpoint deliberately
// answers "sent" for any address, registered or not; this is the pre-check
// the page runs first so an unknown or deactivated email gets a clear error
// instead of a reset link that never arrives. That does make it an
// account-existence oracle, so it sits behind the same DB-backed per-IP
// rate limit as the other public endpoints.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { checkAnonKey, getClientIP, checkRateLimit } from "../_shared/publicAccess.ts";

// Named for the same ReturnType<> inference reason as get-empanelment-status.
function createPublicAdminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createPublicAdminClient> = createPublicAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });
  if (!checkAnonKey(req)) return jsonRes(req, 401, { error: "Unauthorized" });

  const rateResult = await checkRateLimit(adminClient, `reset-email:${getClientIP(req)}`, 10);
  if (!rateResult.allowed) return jsonRes(req, 429, { error: `Too many attempts. Please wait ${rateResult.waitMinutes} minute(s) before trying again.` });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonRes(req, 400, { error: "Please enter a valid email address." });

  const { data: user, error } = await adminClient
    .from("afc_users")
    .select("is_active")
    // Case-insensitive exact match — escape ilike's wildcards so an input
    // like "%@x.com" (or a plain "_" in an address) can't match other rows.
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .maybeSingle();
  if (error) return jsonRes(req, 500, { error: "Database error. Please try again." });
  if (!user) return jsonRes(req, 404, { error: "No account is registered with this email address." });
  if (!user.is_active) return jsonRes(req, 403, { error: "This account has been deactivated. Please contact your administrator." });

  return jsonRes(req, 200, { ok: true });
}

// Wrapped in an arrow rather than passing `handleRequest` to `serve`
// directly: `serve` invokes its handler with a second `connInfo` argument,
// which would otherwise land in `adminClient`'s slot.
if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
