// supabase/functions/delete-staff-user/index.ts
// JWT must be ON. Permanently removes a user — the Supabase Auth account
// (auth.users) AND their afc_users profile, which cascades from it
// (afc_users_id_fkey is ON DELETE CASCADE, same for afc_user_teams). This
// is a genuine hard delete, not the reversible is_active toggle
// (set-user-status) — Admin-only, irreversible.
//
// Every record the account ever touched (leads, proposals, fee notes, chat
// messages, audit log entries, etc.) is preserved — those FKs are
// ON DELETE SET NULL, not NO ACTION (see the
// preserve_records_on_user_delete migration), so deleting the person just
// nulls out their reference on old rows instead of failing. A handful of
// pure membership/OTP rows (a chat participant slot, a committee seat) have
// no meaning without the user and cascade-delete instead. The
// foreign-key-violation branch below is now just a defensive fallback for
// any table that isn't covered by that migration, not the common case.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  if (caller.role !== "admin") {
    return jsonRes(req, 403, { error: "Forbidden. Only Admin can delete user accounts." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const { user_id } = body;
  if (!user_id || typeof user_id !== "string") return jsonRes(req, 400, { error: "user_id is required." });
  if (user_id === caller.id) return jsonRes(req, 400, { error: "You cannot delete your own account." });

  const { data: target, error: targetErr } = await adminClient
    .from("afc_users")
    .select("id, full_name, email, role, is_active")
    .eq("id", user_id)
    .maybeSingle();
  if (targetErr || !target) return jsonRes(req, 404, { error: "User not found." });

  // Guard against locking everyone out — never allow the last active Admin
  // to be deleted, same reasoning as set-user-status would apply to
  // deactivation (that endpoint doesn't special-case it since it's
  // reversible; deletion isn't).
  if (target.role === "admin") {
    const { count } = await adminClient
      .from("afc_users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true)
      .neq("id", user_id);
    if (!count) {
      return jsonRes(req, 400, { error: "At least one active Admin account must remain — deactivate or reassign this one first." });
    }
  }

  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user_id);
  if (deleteErr) {
    const msg = (deleteErr.message || "").toLowerCase();
    if (msg.includes("foreign key") || msg.includes("violat")) {
      return jsonRes(req, 400, {
        error: `${target.full_name} has existing leads, proposals, or other activity on record and can't be permanently deleted. Deactivate the account instead.`,
      });
    }
    return jsonRes(req, 500, { error: "Failed to delete user." });
  }

  await adminClient.from("application_audit_log").insert({
    action_by: caller.id,
    action_by_role: caller.role,
    action: "user_deleted",
    comment: `Permanently deleted ${target.full_name} (${target.email}).`,
  });

  return jsonRes(req, 200, { success: true });
}

// AFC_EDGE_TEST is never set in any real deployment — only by the test
// command (see supabase/functions/deno.json). Wrapped rather than passed
// directly: `serve` invokes its handler with a second `connInfo` argument,
// which would otherwise land in `adminClient`'s slot.
if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
