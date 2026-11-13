// supabase/functions/log-password-changed/index.ts
// JWT must be ON. Fired by useSetNewPassword right after
// supabase.auth.updateUser({ password }) succeeds — from all three places
// that flow through it: MyProfilePage (voluntary change), ChangePasswordPage
// (forced first-login change from a temporary password), and
// ResetPasswordPage (emailed recovery link). Writes an audit_log row so
// admin oversight isn't blind to password changes, including the very
// first one a user makes off their auto-generated temporary password.
// Best-effort from the client's point of view — a logging failure here
// must never block the password change itself.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  try {
    // must_change_password is still true here for a first-time change —
    // the client calls mark_password_changed (which clears it) after this.
    const { data: fullCaller } = await adminClient
      .from("afc_users")
      .select("full_name, must_change_password")
      .eq("id", caller.id)
      .maybeSingle();

    const name = fullCaller?.full_name || caller.email;
    const comment = fullCaller?.must_change_password
      ? `${name} (${caller.email}) set their password for the first time, from a temporary password.`
      : `${name} (${caller.email}) changed their password.`;

    await adminClient.from("application_audit_log").insert({
      action_by: caller.id,
      action_by_role: caller.role,
      action: "password_changed",
      comment,
    });

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
