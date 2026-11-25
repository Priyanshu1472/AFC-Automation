// supabase/functions/send-push/index.ts
// verify_jwt = false — called by the database trigger on notifications
// (public.push_notification_to_devices, 20261125010000) through pg_net,
// authenticated by the x-push-secret header: the database's own
// "push_webhook_secret" Vault entry, checked via the service-role-only
// verify_push_webhook_secret() — so no copy of it lives in function secrets.
//
// Sends one new (or re-bumped chat) notification as a Web Push message to
// every browser its recipient has desktop notifications on in, so it pops
// up even with no PMIS tab open. The service worker (src/sw.js) turns the
// row into the pop-up. Subscriptions the push service reports as gone are
// deleted.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:/https:).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import webpush from "npm:web-push@3.6.7";
import { jsonRes } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/auth.ts";

type Row = { id: number; user_id: string; title: string; sub_text: string | null; link: string | null; is_read: boolean; created_at: string };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

export type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, options: Record<string, unknown>) => Promise<unknown>;

// Push messages are capped at ~4 KB; keep well under it.
export function buildPushPayload(row: Row): string {
  return JSON.stringify({
    id: row.id,
    user_id: row.user_id,
    title: (row.title || "").slice(0, 300),
    sub_text: (row.sub_text || "").slice(0, 1200),
    link: row.link,
    is_read: false,
    created_at: row.created_at,
  });
}

let vapidReady = false;
function defaultSender(): Sender | null {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!pub || !priv || !subject) return null;
  if (!vapidReady) {
    webpush.setVapidDetails(subject, pub, priv);
    vapidReady = true;
  }
  return (sub, payload, options) => webpush.sendNotification(sub, payload, options);
}

// Apple's push service (iPhone/iPad Home Screen apps, Safari) rejects the
// Topic header outright ({"reason":"BadWebPushTopic"}), so it's only sent to
// the others. Pop-ups for one notification still replace each other on every
// platform through the pop-up's tag.
export function pushOptions(endpoint: string, notificationId: number): Record<string, unknown> {
  const options: Record<string, unknown> = {
    TTL: 60 * 60, // undelivered after an hour (browser closed) → drop it
    urgency: "high",
  };
  let host = "";
  try {
    host = new URL(endpoint).hostname;
  } catch { /* stored endpoints are validated URLs */ }
  // Collapses a not-yet-delivered older push for the same notification
  // (chat bumps) into the newest one.
  if (!host.endsWith("push.apple.com")) options.topic = `n${notificationId}`;
  return options;
}

export async function handleRequest(
  req: Request,
  adminClient: ReturnType<typeof createAdminClient> = createAdminClient(),
  send: Sender | null = defaultSender(),
): Promise<Response> {
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const given = req.headers.get("x-push-secret") || "";
  if (!given) return jsonRes(req, 401, { error: "Unauthorized" });
  const { data: valid, error: authErr } = await adminClient.rpc("verify_push_webhook_secret", { p_secret: given });
  if (authErr || valid !== true) return jsonRes(req, 401, { error: "Unauthorized" });
  if (!send) return jsonRes(req, 503, { error: "Push notifications are not configured." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }
  const id = Number(body.notification_id);
  if (!Number.isInteger(id) || id <= 0) return jsonRes(req, 400, { error: "Missing notification_id." });

  try {
    const { data: row, error } = await adminClient
      .from("notifications")
      .select("id, user_id, title, sub_text, link, is_read, created_at")
      .eq("id", id)
      .maybeSingle() as { data: Row | null; error: { message: string } | null };
    if (error) throw new Error(error.message);
    // Read already (e.g. opened in the meantime) or gone — nothing to show.
    if (!row || row.is_read) return jsonRes(req, 200, { sent: 0 });

    const { data: subs, error: subErr } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", row.user_id) as { data: Sub[] | null; error: { message: string } | null };
    if (subErr) throw new Error(subErr.message);
    if (!subs?.length) return jsonRes(req, 200, { sent: 0 });

    const payload = buildPushPayload(row);
    let sent = 0;
    const gone: string[] = [];
    const used: string[] = [];

    await Promise.all(subs.map(async (s) => {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, pushOptions(s.endpoint, row.id));
        sent++;
        used.push(s.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
        // The push service explains a rejection in the body (e.g. Apple:
        // {"reason":"BadJwtToken"}), so log it alongside the status.
        else console.error("send-push delivery failed:", status, new URL(s.endpoint).hostname, (err as { body?: string }).body || (err as Error).message);
      }
    }));

    if (gone.length) await adminClient.from("push_subscriptions").delete().in("id", gone);
    if (used.length) await adminClient.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", used);

    return jsonRes(req, 200, { sent, removed: gone.length });
  } catch (err) {
    console.error("send-push error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Could not send push notification." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
