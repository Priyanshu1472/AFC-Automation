// supabase/functions/_shared/leadActivity.ts
// Append-only workflow timeline for leads — mirrors logActivity() in
// advance-empanelment-stage, shared here since create-lead, update-lead and
// advance-lead-stage all need it.

import { createAdminClient } from "./auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function logLeadActivity(
  admin: AdminClient,
  leadId: string,
  actorId: string | null,
  actorRole: string,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  comment: string | null
) {
  await admin.from("lead_activity_log").insert({
    lead_id: leadId,
    actor_id: actorId,
    actor_role: actorRole,
    action,
    from_status: fromStatus,
    to_status: toStatus,
    comment,
  });
}
