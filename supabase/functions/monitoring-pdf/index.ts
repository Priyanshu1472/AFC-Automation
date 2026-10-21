// supabase/functions/monitoring-pdf/index.ts
// JWT must be ON. Renders a Monitoring / Financials document as base64
// PDF, always fresh from the recorded data (nothing is stored):
//
//   { kind: "client_invoice", id }  — AFC's invoice to the client
//                                     (covering letter + tax invoice).
//   { kind: "payment_note",  id }   — the Project Payment Requisition Note
//                                     sent to Accounts for paying the BP.
//
// Access: anyone who can see the project (can_view_monitoring_project,
// checked as the caller), and the CFO (Accounts) for payment notes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { bytesToBase64 } from "../_shared/letterPdf.ts";
import { buildClientInvoicePdf } from "../_shared/clientInvoicePdf.ts";
import { buildPaymentNotePdf } from "../_shared/paymentNotePdf.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

async function callerCanViewProject(req: Request, projectId: string): Promise<boolean> {
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await userClient.rpc("can_view_monitoring_project", { p_project_id: projectId });
  return !error && data === true;
}

export async function handleRequest(
  req: Request,
  adminClient: AdminClient = createAdminClient(),
  canView: (req: Request, projectId: string) => Promise<boolean> = callerCanViewProject,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;
  if (caller.role === "business_associate") return jsonRes(req, 403, { error: "You do not have access to this document." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }
  const kind = body.kind;
  const id = body.id;
  if (kind !== "client_invoice" && kind !== "payment_note") return jsonRes(req, 400, { error: "Unknown document kind." });
  if (typeof id !== "string" || !id) return jsonRes(req, 400, { error: "id is required." });

  try {
    const table = kind === "client_invoice" ? "client_invoices" : "bp_payment_notes";
    const { data: row } = await adminClient.from(table).select("project_id").eq("id", id).maybeSingle();
    if (!row) return jsonRes(req, 404, { error: "Document not found." });

    const allowed = (kind === "payment_note" && caller.role === "cfo") || await canView(req, row.project_id);
    if (!allowed) return jsonRes(req, 403, { error: "You do not have access to this project." });

    const built = kind === "client_invoice" ? await buildClientInvoicePdf(adminClient, id) : await buildPaymentNotePdf(adminClient, id);
    if (!built.ok) return jsonRes(req, 500, { error: built.error });
    return jsonRes(req, 200, { success: true, pdf_base64: bytesToBase64(built.pdfBytes) });
  } catch (err) {
    console.error("monitoring-pdf failed:", (err as Error).message);
    return jsonRes(req, 500, { error: "Could not build the document." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
