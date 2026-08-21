// supabase/functions/set-own-pin/index.ts
// JWT must be ON. Sets/changes the CALLER'S OWN 5-digit action PIN — used
// to gate committee/MD decisions on leads (see _shared/pin.ts). Mirrors
// MyProfilePage's voluntary password change: the client re-verifies the
// caller's current password via supabase.auth.signInWithPassword() before
// calling this (same UX gate as SetPasswordForm/useSetNewPassword — not a
// cryptographic proof passed through, just the same "prove you're really
// you" step used everywhere else in this app for a sensitive self-service
// change), so this function trusts the caller's JWT identity alone.

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const newPin = body.new_pin;
  if (!isValidPin(newPin)) return jsonRes(req, 400, { error: "PIN must be exactly 5 digits." });

  try {
    const pinHash = await hashPin(newPin, caller.id);
    const { error: updateErr } = await adminClient
      .from("afc_users")
      .update({ pin_hash: pinHash, pin_updated_at: new Date().toISOString() })
      .eq("id", caller.id);
    if (updateErr) throw new Error(updateErr.message);

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Could not update your PIN. Please try again." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
