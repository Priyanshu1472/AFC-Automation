// supabase/functions/set-user-status/index.ts
// JWT must be ON. Flips afc_users.is_active only — the Supabase Auth
// account itself is left intact (reversible; login is already blocked by
// the is_active check in useLogin / ProtectedRoute).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const STATIC_ALLOWED_ORIGINS = ["http://localhost:5173"];
const NETLIFY_SITE_SUFFIX = Deno.env.get("NETLIFY_SITE_SUFFIX") || "";
const EXTRA_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "";

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.includes(origin)) return true;
  if (EXTRA_ORIGIN && origin === EXTRA_ORIGIN) return true;
  if (NETLIFY_SITE_SUFFIX) {
    try {
      return new URL(origin).hostname.endsWith(NETLIFY_SITE_SUFFIX);
    } catch {
      return false;
    }
  }
  return false;
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = isAllowedOrigin(origin) ? origin : STATIC_ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonRes(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

const DGM_CREATABLE_ROLES = ["agm", "srm", "project_officer", "associate_consultant", "project_assistant"];

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonRes(req, 401, { error: "Unauthorized" });

  const payload = decodeJwtPayload(authHeader.replace("Bearer ", "").trim());
  if (!payload?.sub || typeof payload.sub !== "string") {
    return jsonRes(req, 401, { error: "Unauthorized — invalid token payload." });
  }
  const callerUserId = payload.sub;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, supabaseService, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: caller, error: callerErr } = await adminClient
      .from("afc_users")
      .select("id, role, team, is_active")
      .eq("id", callerUserId)
      .single();

    if (callerErr || !caller) return jsonRes(req, 403, { error: "Caller account not found." });
    if (!caller.is_active) return jsonRes(req, 403, { error: "Your account is deactivated." });
    if (!["md", "dgm", "admin"].includes(caller.role)) {
      return jsonRes(req, 403, { error: "Forbidden. Only Admin, MD, or DGM can change user status." });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonRes(req, 400, { error: "Invalid JSON body." });
    }

    const { user_id, is_active } = body;
    if (!user_id || typeof user_id !== "string") return jsonRes(req, 400, { error: "user_id is required." });
    if (typeof is_active !== "boolean") return jsonRes(req, 400, { error: "is_active must be a boolean." });
    if (user_id === caller.id) return jsonRes(req, 400, { error: "You cannot change your own status." });

    const { data: target, error: targetErr } = await adminClient
      .from("afc_users")
      .select("id, role, team, email, full_name")
      .eq("id", user_id)
      .single();
    if (targetErr || !target) return jsonRes(req, 404, { error: "User not found." });

    if (caller.role === "dgm") {
      if (target.team !== caller.team || !DGM_CREATABLE_ROLES.includes(target.role)) {
        return jsonRes(req, 403, { error: "You can only manage users on your own team." });
      }
    } else if (["dgm", "cfo", "cs"].includes(target.role) && !["md", "admin"].includes(caller.role)) {
      // Redundant given the caller.role gate above, but explicit: only
      // MD/Admin may deactivate another senior role.
      return jsonRes(req, 403, { error: "Only MD or Admin can change this user's status." });
    }

    const { error: updateErr } = await adminClient
      .from("afc_users")
      .update({ is_active })
      .eq("id", user_id);
    if (updateErr) return jsonRes(req, 500, { error: "Failed to update user status." });

    await adminClient.from("application_audit_log").insert({
      action_by: caller.id,
      action_by_role: caller.role,
      action: is_active ? "user_activated" : "user_deactivated",
      comment: `${is_active ? "Activated" : "Deactivated"} ${target.full_name} (${target.email})`,
    });

    // ── Notify the affected user (best-effort) ──
    try {
      await adminClient.from("notifications").insert({
        user_id: target.id,
        title: is_active ? "Your account has been activated" : "Your account has been deactivated",
        sub_text: is_active
          ? "You can now sign in to AFC India Limited."
          : "Contact your DGM or administrator if you believe this is a mistake.",
        type: is_active ? "account_activated" : "account_deactivated",
        link: is_active ? "/home" : null,
      });
    } catch (notifErr) {
      console.error("Failed to insert status-change notification:", (notifErr as Error).message);
    }

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
});
