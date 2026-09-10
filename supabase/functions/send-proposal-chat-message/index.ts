// supabase/functions/send-proposal-chat-message/index.ts
// JWT must be ON. Posts one message into a proposal's group chat. Reads are
// governed entirely by RLS (proposal_chat_messages_select, see the
// 20260909000000_proposal_chat migration); this function only needs to gate
// the write: the chat must actually be open, not yet closed by the proposal
// being locked, and the caller must already be on that proposal's roster
// (proposal_chat_participants — bulk-added once at creation, in
// create-proposal-preparation, never by this function itself).
//
// "Locked" mirrors isProposalLocked() (src/lib/proposalPrep.js) and the DB's
// can_edit_proposal(): true either because someone locked it manually
// (proposal_preparations.locked) or because the lead's own
// submission_deadline has passed — both make the rest of the page
// read-only, so the chat closes on the same condition, not just the
// manual-lock flag alone.

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

  const { proposal_id } = body;
  if (!proposal_id || typeof proposal_id !== "string") return jsonRes(req, 400, { error: "proposal_id is required." });

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return jsonRes(req, 400, { error: "Message cannot be empty." });
  if (message.length > MAX_MESSAGE_LENGTH) return jsonRes(req, 400, { error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` });

  const { data: proposal, error: proposalErr } = await adminClient
    .from("proposal_preparations")
    .select("id, locked, chat_opened_at, lead:lead_id(submission_deadline)")
    .eq("id", proposal_id)
    .maybeSingle();
  if (proposalErr || !proposal) return jsonRes(req, 404, { error: "Proposal not found." });

  if (!proposal.chat_opened_at) return jsonRes(req, 400, { error: "Chat isn't open for this proposal yet." });
  const lead = proposal.lead as { submission_deadline: string | null } | null;
  const deadlinePassed = !!lead?.submission_deadline && new Date(lead.submission_deadline) < new Date();
  if (proposal.locked || deadlinePassed) {
    return jsonRes(req, 400, { error: "This proposal is locked — the chat is closed." });
  }

  const { data: participant } = await adminClient
    .from("proposal_chat_participants")
    .select("id")
    .eq("proposal_id", proposal_id)
    .eq("user_id", caller.id)
    .maybeSingle();
  if (!participant) return jsonRes(req, 403, { error: "You're not part of this proposal's chat." });

  const { error: insertErr } = await adminClient.from("proposal_chat_messages").insert({
    proposal_id,
    sender_id: caller.id,
    message,
  });
  if (insertErr) return jsonRes(req, 500, { error: "Failed to send message." });

  return jsonRes(req, 200, { success: true });
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
