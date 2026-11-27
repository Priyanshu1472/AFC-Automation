import { assertEquals } from "jsr:@std/assert@1";
import { handleRequest } from "./index.ts";
import { authedReq, createFakeAdminClient, fakeJwt } from "../_shared/testHelpers.ts";

const CALLER_ID = "caller-1";
const APP_ID = "app-1";

function callerRow(overrides: Record<string, unknown> = {}) {
  return { id: CALLER_ID, role: "associate_consultant", team: "BPDD", office: "delhi", is_active: true, email: "ac@afc.com", ...overrides };
}

function appRow(overrides: Record<string, unknown> = {}) {
  return { id: APP_ID, status: "sent", sent_by: CALLER_ID, ...overrides };
}

function client(caller: Record<string, unknown>, app: Record<string, unknown> | null, deleteResult: Record<string, unknown> = { data: null, error: null }) {
  return createFakeAdminClient({
    afc_users: [{ data: caller, error: null }],
    empanelment_applications: [{ data: app, error: null }, deleteResult],
  });
}

function req(body: Record<string, unknown>) {
  return authedReq("https://x.com/delete-empanelment-application", { token: fakeJwt({ sub: CALLER_ID }), body });
}

Deno.test("delete-empanelment-application - rejects a missing application_id", async () => {
  const res = await handleRequest(req({}), client(callerRow(), appRow()) as never);
  assertEquals(res.status, 400);
});

Deno.test("delete-empanelment-application - 404s on an application that doesn't exist", async () => {
  const res = await handleRequest(req({ application_id: APP_ID }), client(callerRow(), null) as never);
  assertEquals(res.status, 404);
});

Deno.test("delete-empanelment-application - rejects a caller who didn't send this invite", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID }),
    client(callerRow(), appRow({ sent_by: "someone-else" })) as never,
  );
  const json = await res.json();
  assertEquals(res.status, 403);
  assertEquals(json.error, "Only the person who sent this invitation can delete it.");
});

Deno.test("delete-empanelment-application - rejects once the BP has filled the form", async () => {
  const res = await handleRequest(
    req({ application_id: APP_ID }),
    client(callerRow(), appRow({ status: "po_review" })) as never,
  );
  assertEquals(res.status, 400);
});

Deno.test("delete-empanelment-application - the sender can delete their own still-unfilled invite", async () => {
  const res = await handleRequest(req({ application_id: APP_ID }), client(callerRow(), appRow()) as never);
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json, { success: true });
});
