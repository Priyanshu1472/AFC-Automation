// supabase/functions/admin-reset-pin/index.ts
// JWT must be ON. Admin-only: sets a new 4-digit action PIN for ANY user
// (the PIN is one-way hashed — there is no "view the current PIN", only
// reset it to a new value). The client re-verifies the ADMIN's OWN
// password via supabase.auth.signInWithPassword() before calling this,
// same gate as every other sensitive self-service action in this app —
// this function trusts the caller's JWT identity plus the role check
// below.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { hashPin, isValidPin } from "../_shared/pin.ts";

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;
  if (caller.role !== "admin") return jsonRes(req, 403, { error: "Only Admin can reset another user's PIN." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const userId = body.user_id;
  const newPin = body.new_pin;
  if (typeof userId !== "string" || !userId) return jsonRes(req, 400, { error: "user_id is required." });
  if (!isValidPin(newPin)) return jsonRes(req, 400, { error: "PIN must be exactly 4 digits." });

  try {
    const { data: target, error: targetErr } = await adminClient.from("afc_users").select("id").eq("id", userId).maybeSingle();
    if (targetErr || !target) return jsonRes(req, 404, { error: "User not found." });

    const pinHash = await hashPin(newPin, userId);
    const { error: updateErr } = await adminClient
      .from("afc_users")
      .update({ pin_hash: pinHash, pin_updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (updateErr) throw new Error(updateErr.message);

    await adminClient.from("application_audit_log").insert({
      action_by: caller.id,
      action_by_role: caller.role,
      action: "user_pin_reset",
      comment: `Reset the action PIN for user ${userId}.`,
    });

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Could not reset the PIN. Please try again." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
