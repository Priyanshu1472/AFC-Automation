// supabase/functions/update-staff-user/index.ts
// JWT must be ON. Fixes mistakes on an EXISTING afc_users row — distinct
// from create-staff-user (which mints a new account). Admin/MD/DGM can all
// edit; only Admin/MD can change the `role` field itself (see
// can.editUserRole in src/lib/roles.js) and only within
// ADMIN_CREATABLE_ROLES, the same whitelist create-staff-user enforces for
// Admin — this stops a role edit from being used to promote someone to
// md/admin. A DGM may only edit users on their own team, and can never
// touch `role`.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

const ADMIN_CREATABLE_ROLES = ["cfo", "cs", "dgm", "agm", "srm", "project_officer", "associate_consultant", "project_assistant"];

// Lead Generation review committees — same admin/md-only gate as `role`
// itself, since committee membership grants review/approval permission
// just like a role does.
const LEAD_COMMITTEES = ["PMT", "PMT Extended", "G3"];

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  if (!["admin", "md", "dgm"].includes(caller.role)) {
    return jsonRes(req, 403, { error: "Forbidden. Only Admin, MD, or DGM can edit user accounts." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const { user_id, full_name, team, office, role, committee } = body;
  if (!user_id || typeof user_id !== "string") return jsonRes(req, 400, { error: "user_id is required." });
  if (!full_name || typeof full_name !== "string" || full_name.trim().length < 2) {
    return jsonRes(req, 400, { error: "Full name is required." });
  }
  if (user_id === caller.id) return jsonRes(req, 400, { error: "You cannot edit your own account here." });
  if (committee !== undefined && committee !== null && !LEAD_COMMITTEES.includes(committee as string)) {
    return jsonRes(req, 400, { error: `Committee must be one of: ${LEAD_COMMITTEES.join(", ")}.` });
  }

  const { data: target, error: targetErr } = await adminClient
    .from("afc_users")
    .select("id, role, team, office")
    .eq("id", user_id)
    .maybeSingle();
  if (targetErr || !target) return jsonRes(req, 404, { error: "User not found." });

  const update: Record<string, unknown> = { full_name: full_name.trim() };

  if (caller.role === "dgm") {
    if (target.team !== caller.team) {
      return jsonRes(req, 403, { error: "You can only edit users on your own team." });
    }
    if (role !== undefined && role !== target.role) {
      return jsonRes(req, 403, { error: "DGM cannot change a user's role — ask an Admin or MD." });
    }
    // A DGM's edits stay within their own team/office, same as creation.
    update.team = caller.team;
    update.office = caller.office;
  } else {
    // Admin / MD. Only validate the role against the whitelist when it's
    // actually changing — otherwise editing an existing md/admin account's
    // name would be rejected just because their current role isn't in
    // ADMIN_CREATABLE_ROLES (that list is for what a NEW role can be set
    // to, not for what's already on the row).
    if (role !== undefined && role !== target.role) {
      if (typeof role !== "string" || !ADMIN_CREATABLE_ROLES.includes(role)) {
        return jsonRes(req, 403, { error: `Role must be one of: ${ADMIN_CREATABLE_ROLES.join(", ")}.` });
      }
      update.role = role;
    }
    // Same admin/md-only gate as role — a committee grants review/approval
    // permission just like a role does.
    if (committee !== undefined) update.committee = (committee as string) || null;
    if (team !== undefined) update.team = (team as string) || null;
    if (office !== undefined) update.office = (office as string) || null;
  }

  const { error: updateErr } = await adminClient.from("afc_users").update(update).eq("id", user_id);
  if (updateErr) return jsonRes(req, 500, { error: "Failed to update user." });

  await adminClient.from("application_audit_log").insert({
    action_by: caller.id,
    action_by_role: caller.role,
    action: "user_edited",
    comment: `Edited user ${user_id} — ${JSON.stringify(update)}`,
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
