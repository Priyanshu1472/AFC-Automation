// supabase/functions/get-empanelment-correction-info/index.ts
// JWT verification must be OFF (public, BA-facing). Given an application
// code, returns the BA's full submitted registration (so the correction page
// can show the whole form for context) plus the list of currently-open
// compliance flags, which alone determine what's actually editable —
// enforced again server-side in submit-empanelment-correction.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { checkAnonKey, getClientIP, checkRateLimit } from "../_shared/publicAccess.ts";

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });
  if (!checkAnonKey(req)) return jsonRes(req, 401, { error: "Unauthorized" });

  const rateResult = checkRateLimit(rateLimitStore, getClientIP(req));
  if (!rateResult.allowed) return jsonRes(req, 429, { error: `Too many attempts. Please wait ${rateResult.waitMinutes} minute(s) before trying again.` });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const appCode = typeof body.application_code === "string" ? body.application_code.trim() : "";
  if (!/^\d{5}$/.test(appCode)) return jsonRes(req, 400, { error: "Application code must be exactly 5 digits." });

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: application, error: appErr } = await adminClient
    .from("empanelment_applications")
    .select("id, status")
    .eq("application_code", appCode)
    .maybeSingle();
  if (appErr) return jsonRes(req, 500, { error: "Database error. Please try again." });
  if (!application) return jsonRes(req, 400, { error: "Invalid application code. Please check and try again." });
  if (application.status !== "on_hold") return jsonRes(req, 400, { error: `This application is in "${application.status}" status — there is nothing pending correction.` });

  const { data: flags, error: flagsErr } = await adminClient
    .from("compliance_flags")
    .select("field_key, field_label, comment")
    .eq("application_id", application.id)
    .eq("status", "open")
    .order("created_at");
  if (flagsErr) return jsonRes(req, 500, { error: "Database error. Please try again." });

  const { data: reg } = await adminClient.from("ba_registrations").select("*").eq("application_id", application.id).maybeSingle();

  return jsonRes(req, 200, { org_name: reg?.org_name || null, registration: reg || null, flags: flags || [] });
});
