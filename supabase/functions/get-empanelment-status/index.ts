// supabase/functions/get-empanelment-status/index.ts
// JWT verification must be OFF (public, BA-facing). Given an application
// code, returns a status-only view of the application — current stage,
// activity timeline, and (when relevant) open compliance flags or final
// remarks — for the public "Check Application Status" page. Unlike
// get-empanelment-correction-info, this deliberately does NOT return the
// full ba_registrations row (no edit flow here, so no need to expose it),
// and the activity log is stripped of staff actor names before it leaves
// the server.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { checkAnonKey, getClientIP, checkRateLimit } from "../_shared/publicAccess.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });
  if (!checkAnonKey(req)) return jsonRes(req, 401, { error: "Unauthorized" });

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const rateResult = await checkRateLimit(adminClient, `status:${getClientIP(req)}`);
  if (!rateResult.allowed) return jsonRes(req, 429, { error: `Too many attempts. Please wait ${rateResult.waitMinutes} minute(s) before trying again.` });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const appCode = typeof body.application_code === "string" ? body.application_code.trim() : "";
  if (!/^\d{5}$/.test(appCode)) return jsonRes(req, 400, { error: "Application code must be exactly 5 digits." });

  const { data: application, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status, application_code, created_at, md_remarks, dgm_comment")
    .eq("application_code", appCode)
    .maybeSingle();
  if (appErr) return jsonRes(req, 500, { error: "Database error. Please try again." });
  if (!application) return jsonRes(req, 400, { error: "Invalid application code. Please check and try again." });

  const { data: reg } = await adminClient.from("ba_registrations").select("org_name").eq("application_id", application.id).maybeSingle();

  const { data: logs, error: logsErr } = await adminClient
    .from("empanelment_activity_log")
    .select("id, actor_role, action, comment, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: true });
  if (logsErr) return jsonRes(req, 500, { error: "Database error. Please try again." });

  let flags: Array<{ field_label: string; comment: string }> = [];
  if (application.status === "on_hold") {
    const { data: openFlags } = await adminClient
      .from("compliance_flags")
      .select("field_label, comment")
      .eq("application_id", application.id)
      .eq("status", "open")
      .order("created_at");
    flags = openFlags || [];
  }

  return jsonRes(req, 200, {
    org_name: reg?.org_name || null,
    status: application.status,
    application_code: application.application_code,
    created_at: application.created_at,
    final_remark: ["accepted", "rejected"].includes(application.status) ? application.md_remarks || application.dgm_comment || null : null,
    flags,
    logs: logs || [],
  });
});
