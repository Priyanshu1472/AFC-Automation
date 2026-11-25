// supabase/functions/push-subscription/index.ts
// JWT must be ON. Web Push registration for the CALLER'S browser (see
// src/lib/pushSubscription.js):
//   { action: "key" }                          → { public_key } (VAPID)
//   { action: "subscribe", subscription, user_agent }
//        saves the browser's push subscription against the caller. A
//        browser's subscription belongs to one user only, so saving it while
//        signed in as someone else moves it to them.
//   { action: "unsubscribe", endpoint }        → removes it (sign-out / off)
// push_subscriptions has RLS on and no policies — only this function and
// send-push (service role) ever touch it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

// Real browser push services only — send-push POSTs to whatever endpoint is
// stored, so an arbitrary URL must never get in.
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com", // Chrome, Android
  ".notify.windows.com", // Edge
  "push.services.mozilla.com", // Firefox
  ".push.apple.com", // Safari
];

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    return PUSH_HOST_SUFFIXES.some((s) => url.hostname === s.replace(/^\./, "") || url.hostname.endsWith(s.startsWith(".") ? s : `.${s}`));
  } catch {
    return false;
  }
}

function isKey(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 200 && /^[A-Za-z0-9_-]+={0,2}$/.test(v);
}

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

  try {
    if (body.action === "key") {
      const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
      if (!publicKey) return jsonRes(req, 503, { error: "Push notifications are not configured." });
      return jsonRes(req, 200, { public_key: publicKey });
    }

    if (body.action === "subscribe") {
      const sub = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
      if (!isAllowedPushEndpoint(sub?.endpoint) || !isKey(sub?.keys?.p256dh) || !isKey(sub?.keys?.auth)) {
        return jsonRes(req, 400, { error: "Invalid push subscription." });
      }
      const userAgent = typeof body.user_agent === "string" ? body.user_agent.slice(0, 300) : null;
      const { error } = await adminClient.from("push_subscriptions").upsert(
        {
          endpoint: sub!.endpoint,
          user_id: caller.id,
          p256dh: sub!.keys!.p256dh,
          auth: sub!.keys!.auth,
          user_agent: userAgent,
          created_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(error.message);
      return jsonRes(req, 200, { success: true });
    }

    if (body.action === "unsubscribe") {
      // Holding the endpoint URL is proof it's this browser's own
      // subscription, whoever it was last saved for.
      if (typeof body.endpoint !== "string" || !body.endpoint) return jsonRes(req, 400, { error: "Missing endpoint." });
      const { error } = await adminClient.from("push_subscriptions").delete().eq("endpoint", body.endpoint);
      if (error) throw new Error(error.message);
      return jsonRes(req, 200, { success: true });
    }

    return jsonRes(req, 400, { error: "Unknown action." });
  } catch (err) {
    console.error("push-subscription error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Could not update desktop notifications. Please try again." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
