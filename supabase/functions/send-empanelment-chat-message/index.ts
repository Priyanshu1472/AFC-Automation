// supabase/functions/send-empanelment-chat-message/index.ts
// JWT must be ON. Posts one message into an empanelment application's group
// chat. Reads are governed by RLS (empanelment_chat_messages_select, see the
// 20261006000000 migration); this function only gates the write.
//
// Participants are fixed by the application itself — no roster table:
//   - the sender (sent_by — AC / PA / PO)
//   - the assigned Project Officer (project_officer_id)
//   - the assigned advising authority (dgm_id)
//   - every active CFO, CS and MD
// The chat closes (read-only) once the MD has made a final decision.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const MAX_MESSAGE_LENGTH = 4000;
const ORG_WIDE_PARTICIPANT_ROLES = ["cfo", "cs", "md"];
const CLOSED_STATUSES = ["accepted", "rejected"];

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

  const { application_id } = body;
  if (!application_id || typeof application_id !== "string") return jsonRes(req, 400, { error: "application_id is required." });

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return jsonRes(req, 400, { error: "Message cannot be empty." });
  if (message.length > MAX_MESSAGE_LENGTH) return jsonRes(req, 400, { error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` });

  const { data: app, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, sent_by, project_officer_id, dgm_id")
    .eq("id", application_id)
    .maybeSingle();
  if (appErr || !app) return jsonRes(req, 404, { error: "Application not found." });

  if (CLOSED_STATUSES.includes(app.status)) return jsonRes(req, 400, { error: "A final decision has been made on this application — the chat is closed." });

  const isParticipant =
    [app.sent_by, app.project_officer_id, app.dgm_id].includes(caller.id) ||
    ORG_WIDE_PARTICIPANT_ROLES.includes(caller.role);
  if (!isParticipant) return jsonRes(req, 403, { error: "You're not part of this application's chat." });

  const { error: insertErr } = await adminClient.from("empanelment_chat_messages").insert({
    application_id,
    sender_id: caller.id,
    message,
  });
  if (insertErr) return jsonRes(req, 500, { error: "Failed to send message." });

  return jsonRes(req, 200, { success: true });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
