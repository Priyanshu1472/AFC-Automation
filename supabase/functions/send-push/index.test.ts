import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest, buildPushPayload, type Sender } from "./index.ts";
import { createFakeAdminClient, type FakeResult } from "../_shared/testHelpers.ts";

const ROW = { id: 42, user_id: "u-1", title: "Lead awaiting your review", sub_text: "AFC/BPDD/L/26/001", link: "/leads/abc", is_read: false, created_at: "2026-11-25T08:00:00Z" };
const SUBS = [
  { id: "s-1", endpoint: "https://fcm.googleapis.com/fcm/send/a", p256dh: "k1", auth: "a1" },
  { id: "s-2", endpoint: "https://wns2-pn1p.notify.windows.com/w/?token=b", p256dh: "k2", auth: "a2" },
];

function client(row: unknown = ROW, subs: unknown = SUBS, secretOk = true) {
  const routes: Record<string, FakeResult[]> = {
    notifications: [{ data: row, error: null }],
    push_subscriptions: [{ data: subs, error: null }, { data: null, error: null }, { data: null, error: null }],
  };
  // verify_push_webhook_secret() is true only for the real secret.
  return createFakeAdminClient(routes, { rpc: { verify_push_webhook_secret: { data: secretOk, error: null } } });
}

const req = (body: unknown = { notification_id: 42 }, secret = "s3cret") =>
  new Request("https://x.com/send-push", { method: "POST", headers: secret ? { "x-push-secret": secret } : {}, body: JSON.stringify(body) });

function recorder(fail: Record<string, number> = {}) {
  const sent: { endpoint: string; payload: string; options: Record<string, unknown> }[] = [];
  const send: Sender = (sub, payload, options) => {
    if (fail[sub.endpoint]) return Promise.reject(Object.assign(new Error("push failed"), { statusCode: fail[sub.endpoint] }));
    sent.push({ endpoint: sub.endpoint, payload, options });
    return Promise.resolve();
  };
  return { sent, send };
}

Deno.test("send-push - wrong secret is refused", async () => {
  const r = recorder();
  const res = await handleRequest(req(undefined, "nope"), client(ROW, SUBS, false) as never, r.send);
  assertEquals(res.status, 401);
  const missing = await handleRequest(req(undefined, ""), client() as never, r.send);
  assertEquals(missing.status, 401);
  assertEquals(r.sent.length, 0);
});

Deno.test("send-push - sends the notification to every browser of its recipient", async () => {
  const r = recorder();
  const res = await handleRequest(req(), client() as never, r.send);
  assertEquals(await res.json(), { sent: 2, removed: 0 });
  assertEquals(r.sent.map((s) => s.endpoint), SUBS.map((s) => s.endpoint));
  const payload = JSON.parse(r.sent[0].payload);
  assertEquals(payload.id, 42);
  assertEquals(payload.link, "/leads/abc");
  assertEquals(r.sent[0].options.topic, "n42");
});

Deno.test("send-push - looks up subscriptions for the notification's own user only", async () => {
  const fake = client();
  await handleRequest(req(), fake as never, recorder().send);
  const subQuery = fake.__log.find((l) => l.table === "push_subscriptions")!;
  assertEquals(subQuery.calls.find((c) => c[0] === "eq"), ["eq", '"user_id"', '"u-1"']);
});

Deno.test("send-push - a notification already read is not pushed", async () => {
  const r = recorder();
  const res = await handleRequest(req(), client({ ...ROW, is_read: true }) as never, r.send);
  assertEquals(await res.json(), { sent: 0 });
  assertEquals(r.sent.length, 0);
});

Deno.test("send-push - drops subscriptions the push service says are gone", async () => {
  const r = recorder({ [SUBS[0].endpoint]: 410 });
  const fake = client();
  const res = await handleRequest(req(), fake as never, r.send);
  assertEquals(await res.json(), { sent: 1, removed: 1 });
  const del = fake.__log.filter((l) => l.table === "push_subscriptions").find((l) => l.calls[0][0] === "delete")!;
  assertEquals(del.calls[1], ["in", '"id"', '["s-1"]']);
});

Deno.test("send-push - not configured (no VAPID keys) answers 503 instead of failing silently", async () => {
  const res = await handleRequest(req(), client() as never, null);
  assertEquals(res.status, 503);
});

Deno.test("send-push - payload stays well under the 4 KB push limit", () => {
  const big = buildPushPayload({ ...ROW, sub_text: "x".repeat(10000), title: "t".repeat(1000) });
  assertEquals(new TextEncoder().encode(big).length < 3000, true);
});
