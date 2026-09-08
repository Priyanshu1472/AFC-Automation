// supabase/functions/request-fee-note-otp/index.ts
// JWT must be ON. Issues a one-time code emailed to the CALLER'S OWN
// registered address, gating decide-fee-note-md. Re-runs the same
// auth/state guard the real action uses so a stray OTP request can't probe
// fee notes the caller isn't actually allowed to act on.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { issueFeeNoteOtp } from "../_shared/feeNoteOtp.ts";

const OTP_ACTIONS = new Set(["md_approve", "md_reject"]);

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

  const { fee_note_id: feeNoteId, action } = body;
  if (typeof feeNoteId !== "string" || !feeNoteId) return jsonRes(req, 400, { error: "fee_note_id is required." });
  if (typeof action !== "string" || !OTP_ACTIONS.has(action)) return jsonRes(req, 400, { error: "Invalid action." });

  if (caller.role !== "md") return jsonRes(req, 403, { error: "Only the MD can act at this stage." });

  const { data: note, error: fetchErr } = await adminClient
    .from("fee_notes")
    .select("id, status")
    .eq("id", feeNoteId)
    .maybeSingle();
  if (fetchErr || !note) return jsonRes(req, 404, { error: "Fee note not found." });
  if (note.status !== "pending_md") {
    return jsonRes(req, 400, { error: `This fee note is "${note.status}", not "pending_md". It may have just been updated by someone else — refresh and try again.` });
  }

  const result = await issueFeeNoteOtp(adminClient, {
    userId: caller.id,
    userEmail: caller.email,
    feeNoteId,
    action,
  });
  if (!result.ok) return jsonRes(req, 429, { error: result.error });

  return jsonRes(req, 200, { success: true, sent_to: caller.email });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
