import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest, isAllowedPushEndpoint } from "./index.ts";
import { createFakeAdminClient, type FakeResult } from "../_shared/testHelpers.ts";

// Caller lookup (getCallerProfile) reads afc_users then the team/committee
// membership tables; the fake repeats each table's last result.
function client(extra: Record<string, FakeResult[]> = {}) {
  return createFakeAdminClient({
    afc_users: [{ data: { id: "u-1", role: "dgm", team: "BPDD", office: null, committee: null, is_active: true, email: "u@afc.com", pin_hash: null }, error: null }],
    afc_user_teams: [{ data: [], error: null }],
    afc_user_committees: [{ data: [], error: null }],
    push_subscriptions: [{ data: null, error: null }],
    ...extra,
  });
}

function jwt(sub = "u-1") {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ sub })}.sig`;
}

const req = (body: unknown) =>
  new Request("https://x.com/push-subscription", { method: "POST", headers: { authorization: `Bearer ${jwt()}` }, body: JSON.stringify(body) });

const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BNcR-key_1", auth: "auth_2" } };

Deno.test("push-subscription - only real browser push services are accepted as endpoints", () => {
  assertEquals(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"), true);
  assertEquals(isAllowedPushEndpoint("https://wns2-pn1p.notify.windows.com/w/?token=x"), true);
  assertEquals(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"), true);
  assertEquals(isAllowedPushEndpoint("https://web.push.apple.com/abc"), true);
  assertEquals(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc"), false);
  assertEquals(isAllowedPushEndpoint("https://evil.example.com/fcm.googleapis.com"), false);
  assertEquals(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.com/x"), false);
  assertEquals(isAllowedPushEndpoint("https://169.254.169.254/latest"), false);
});

Deno.test("push-subscription - returns the VAPID public key", async () => {
  Deno.env.set("VAPID_PUBLIC_KEY", "PUBKEY");
  const res = await handleRequest(req({ action: "key" }), client() as never);
  assertEquals(await res.json(), { public_key: "PUBKEY" });
});

Deno.test("push-subscription - saves the browser against the caller (moving it from anyone else)", async () => {
  const fake = client();
  const res = await handleRequest(req({ action: "subscribe", subscription: SUB, user_agent: "Chrome" }), fake as never);
  assertEquals(res.status, 200);
  const upsert = fake.__log.filter((l) => l.table === "push_subscriptions").flatMap((l) => l.calls).find((c) => c[0] === "upsert")!;
  const row = JSON.parse(upsert[1]);
  assertEquals(row.user_id, "u-1");
  assertEquals(row.endpoint, SUB.endpoint);
  assertEquals(JSON.parse(upsert[2]), { onConflict: "endpoint" });
});

Deno.test("push-subscription - rejects a non-push endpoint", async () => {
  const res = await handleRequest(req({ action: "subscribe", subscription: { ...SUB, endpoint: "https://example.com/hook" } }), client() as never);
  assertEquals(res.status, 400);
});

Deno.test("push-subscription - unsubscribe deletes by endpoint", async () => {
  const fake = client();
  const res = await handleRequest(req({ action: "unsubscribe", endpoint: SUB.endpoint }), fake as never);
  assertEquals(res.status, 200);
  const del = fake.__log.filter((l) => l.table === "push_subscriptions").find((l) => l.calls[0][0] === "delete")!;
  assertEquals(del.calls[1], ["eq", '"endpoint"', JSON.stringify(SUB.endpoint)]);
});
