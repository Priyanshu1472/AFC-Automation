import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { escapeHtml, sendResendEmail, wrapEmailBody } from "./email.ts";

Deno.test("escapeHtml - escapes all five HTML-special characters", () => {
  assertEquals(escapeHtml(`<b>"Tom" & 'Jerry'</b>`), "&lt;b&gt;&quot;Tom&quot; &amp; &#x27;Jerry&#x27;&lt;/b&gt;");
});

Deno.test("escapeHtml - null/undefined become empty string, not the literal word", () => {
  assertEquals(escapeHtml(null), "");
  assertEquals(escapeHtml(undefined), "");
});

Deno.test("escapeHtml - passes through safe strings unchanged", () => {
  assertEquals(escapeHtml("hello world"), "hello world");
});

Deno.test("wrapEmailBody - embeds the supplied body HTML verbatim", () => {
  const html = wrapEmailBody("<p>hello unique marker 123</p>");
  assertStringIncludes(html, "<p>hello unique marker 123</p>");
  assertStringIncludes(html, "AFC India Limited");
});

Deno.test("sendResendEmail - returns false without calling fetch when RESEND_API_KEY is unset", async () => {
  Deno.env.delete("RESEND_API_KEY");
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalled = true;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    const result = await sendResendEmail({ to: "a@b.com", subject: "hi", html: "<p>hi</p>" });
    assertEquals(result, false);
    assertEquals(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sendResendEmail - returns true on a 2xx Resend response", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) => {
    assertEquals(url, "https://api.resend.com/emails");
    assertStringIncludes((init.headers as Record<string, string>)["Authorization"], "test-key");
    return Promise.resolve(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
  }) as typeof fetch;
  try {
    const result = await sendResendEmail({ to: "a@b.com", subject: "hi", html: "<p>hi</p>" });
    assertEquals(result, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sendResendEmail - returns false when Resend responds with a non-2xx status", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("rate limited", { status: 429 }))) as typeof fetch;
  try {
    const result = await sendResendEmail({ to: "a@b.com", subject: "hi", html: "<p>hi</p>" });
    assertEquals(result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sendResendEmail - includes cc in the request body when passed, omits it when not", async () => {
  Deno.env.set("RESEND_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  let sentBody: Record<string, unknown> = {};
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    sentBody = JSON.parse(init.body as string);
    return Promise.resolve(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
  }) as typeof fetch;
  try {
    await sendResendEmail({ to: "a@b.com", cc: "sender@afc.com", subject: "hi", html: "<p>hi</p>" });
    assertEquals(sentBody.cc, ["sender@afc.com"]);

    await sendResendEmail({ to: "a@b.com", subject: "hi", html: "<p>hi</p>" });
    assertEquals(Object.prototype.hasOwnProperty.call(sentBody, "cc"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
