// supabase/functions/verify-own-password/index.ts
// JWT must be ON. Confirms the caller's OWN password is correct, for every
// "prove it's really you before this sensitive change" gate in the app
// (Change Password, Set/Reset Action PIN, Delete User) — without actually
// starting a new session.
//
// Used to be done client-side via supabase.auth.signInWithPassword(),
// which quietly broke the moment Turnstile captcha was enabled on this
// project: GoTrue requires a valid captcha_token on every password-grant
// sign-in from the anon key, and none of these "just confirm my password"
// call sites had (or should have) a Turnstile widget of their own — so
// every one of them started failing with a generic "captcha protection:
// request disallowed" error surfaced to the user as a bogus "your password
// is incorrect".
//
// The fix: do the check here instead, through the SERVICE ROLE key.
// Captcha protection in Supabase Auth only applies to requests made with
// the public anon key (it exists to stop public/anonymous credential
// stuffing) — a service-role-authenticated signInWithPassword call is
// exempt, confirmed empirically against this project. This endpoint
// discards whatever session that check would have started (the admin
// client here never persists one) and only ever reports true/false.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

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

  const { password } = body;
  if (!password || typeof password !== "string") return jsonRes(req, 400, { error: "password is required." });

  const { error } = await adminClient.auth.signInWithPassword({ email: caller.email, password });
  if (error) return jsonRes(req, 400, { error: "Your password is incorrect." });

  return jsonRes(req, 200, { success: true });
}

// AFC_EDGE_TEST is never set in any real deployment — only by the test
// command (see supabase/functions/deno.json). Wrapped rather than passed
// directly: `serve` invokes its handler with a second `connInfo` argument,
// which would otherwise land in `adminClient`'s slot.
if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
