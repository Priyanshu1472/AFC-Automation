// supabase/functions/send-lead-chat-message/index.ts
// JWT must be ON. Posts one message into a lead's group chat. Reads are
// governed entirely by RLS (lead_chat_messages_select, see the
// 20260825030000_lead_chat migration); this function only needs to gate the
// write: the chat must actually be open, not yet locked by MD approval, and
// the caller must already be on that lead's roster (lead_chat_participants
// — bulk-added by advance-lead-stage as the lead moves through committees,
// never by this function itself).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const MAX_MESSAGE_LENGTH = 4000;

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

  const { lead_id } = body;
  if (!lead_id || typeof lead_id !== "string") return jsonRes(req, 400, { error: "lead_id is required." });

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return jsonRes(req, 400, { error: "Message cannot be empty." });
  if (message.length > MAX_MESSAGE_LENGTH) return jsonRes(req, 400, { error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` });

  const { data: lead, error: leadErr } = await adminClient
    .from("leads")
    .select("id, status, chat_opened_at")
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

  if (!lead.chat_opened_at) return jsonRes(req, 400, { error: "Chat isn't open for this lead yet." });
  if (lead.status === "md_approved") return jsonRes(req, 400, { error: "This lead has been approved — the chat is closed." });

  const { data: participant } = await adminClient
    .from("lead_chat_participants")
    .select("id")
    .eq("lead_id", lead_id)
    .eq("user_id", caller.id)
    .maybeSingle();
  if (!participant) return jsonRes(req, 403, { error: "You're not part of this lead's chat." });

  const { error: insertErr } = await adminClient.from("lead_chat_messages").insert({
    lead_id,
    sender_id: caller.id,
    message,
  });
  if (insertErr) return jsonRes(req, 500, { error: "Failed to send message." });

  return jsonRes(req, 200, { success: true });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
