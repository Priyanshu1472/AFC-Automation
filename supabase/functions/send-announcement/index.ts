// supabase/functions/send-announcement/index.ts
// JWT must be ON. Super Admin's "Important Updates" broadcast — inserts
// one org_announcements row, which ImportantUpdatesModal.jsx then shows
// as a full-screen, un-dismissable popup to every active user who hasn't
// acknowledged it yet (on login, tab refocus, or live via realtime).
// Deliberately never touches the `notifications` table — this must never
// appear in the normal notification bell/panel. Sending is final: there's
// no edit/withdraw, only ever sending a new one (which simply supersedes
// the last, since the frontend always reads the single latest row).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const MAX_ITEMS = 50;
const MAX_ITEM_LENGTH = 500;

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  // caller.role normalizes a Super Admin to "admin" (every Admin power,
  // see _shared/auth.ts) — this one stays Super-Admin-exclusive, so it
  // checks actual_role, the unnormalized value, instead.
  if (caller.actual_role !== "super_admin") return jsonRes(req, 403, { error: "Only Super Admin can send an organisation-wide update." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().slice(0, MAX_ITEM_LENGTH))
    .slice(0, MAX_ITEMS);

  if (!items.length) return jsonRes(req, 400, { error: "Add at least one update." });

  try {
    const { error: insertErr } = await adminClient
      .from("org_announcements")
      .insert({ items, created_by: caller.id });
    if (insertErr) throw new Error(insertErr.message);

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Failed to send. Try again." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
