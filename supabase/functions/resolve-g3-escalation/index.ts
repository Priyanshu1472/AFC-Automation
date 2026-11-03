// supabase/functions/resolve-g3-escalation/index.ts
// JWT must be ON. MD's decision on an open G3 escalation (see
// escalate-lead-to-g3): accepts exactly one of the conflicting leads.
// Conflict picks can join at any stage now, so each member's
// previous_status (snapshotted when it joined — see
// 20261104010000_lead_g3_conflict_any_stage.sql) decides where the
// accepted lead resumes: straight to md_review if it had already cleared
// Recommending Authority (previous_status pmt_review or md_review),
// otherwise restored to exactly the stage it was at before escalation —
// no special-casing needed there, it just continues through the normal
// flow from there like any other lead. Every other member lead is
// auto-dropped regardless of its own previous_status.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
import { verifyActionPin } from "../_shared/pin.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

type MemberRow = {
  lead_id: string;
  previous_status: string | null;
  leads: { id: string; lead_number: string; title: string; created_by: string; person_responsible_id: string };
};

// A member lead resumes straight at md_review if it had already cleared
// Recommending Authority before joining the escalation.
const PAST_RECOMMENDING_AUTHORITY = new Set(["pmt_review", "md_review"]);

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  if (caller.role !== "md") return jsonRes(req, 403, { error: "Only the MD can resolve a G3 escalation." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const escalationId = typeof body.escalation_id === "string" ? body.escalation_id : "";
  const acceptedLeadId = typeof body.accepted_lead_id === "string" ? body.accepted_lead_id : "";
  if (!escalationId || !acceptedLeadId) return jsonRes(req, 400, { error: "escalation_id and accepted_lead_id are required." });

  try {
    const { data: escalation, error: escErr } = await adminClient
      .from("lead_g3_escalations")
      .select("id, status")
      .eq("id", escalationId)
      .maybeSingle();
    if (escErr || !escalation) return jsonRes(req, 404, { error: "Escalation not found." });
    if (escalation.status !== "open") return jsonRes(req, 400, { error: "This escalation has already been resolved." });

    const { data: memberRows, error: membersErr } = await adminClient
      .from("lead_g3_escalation_members")
      .select("lead_id, previous_status, leads(id, lead_number, title, created_by, person_responsible_id)")
      .eq("escalation_id", escalationId);
    if (membersErr || !memberRows?.length) return jsonRes(req, 500, { error: "Failed to load the escalation's leads." });

    const members = (memberRows as unknown as MemberRow[]).map((m) => ({ ...m.leads, previous_status: m.previous_status }));
    const accepted = members.find((l) => l.id === acceptedLeadId);
    if (!accepted) return jsonRes(req, 400, { error: "That lead isn't part of this escalation." });

    const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
    if (pinErr) return jsonRes(req, 400, { error: pinErr });

    const acceptedFinalStatus =
      accepted.previous_status && PAST_RECOMMENDING_AUTHORITY.has(accepted.previous_status) ? "md_review" : accepted.previous_status || "md_review";

    const { error: acceptErr } = await adminClient
      .from("leads")
      .update({ status: acceptedFinalStatus })
      .eq("id", accepted.id)
      .eq("status", "g3_review");
    if (acceptErr) return jsonRes(req, 500, { error: "Failed to accept the lead." });
    await logLeadActivity(adminClient, accepted.id, caller.id, "md", "g3_accepted", "g3_review", acceptedFinalStatus, "Accepted after G3 committee review.");
    await notifyUsers(adminClient, [accepted.created_by, accepted.person_responsible_id], {
      title: "Lead accepted after G3 review",
      sub_text:
        acceptedFinalStatus === "md_review"
          ? `${accepted.lead_number} — "${accepted.title}" was accepted after G3 committee review and is proceeding to MD approval.`
          : `${accepted.lead_number} — "${accepted.title}" was accepted after G3 committee review and resumes its normal approval process.`,
      type: "info",
      link: `/leads/${accepted.id}`,
    });

    const dropped = members.filter((l) => l.id !== accepted.id);
    for (const lead of dropped) {
      const { error: dropErr } = await adminClient.from("leads").update({ status: "pa_dropped" }).eq("id", lead.id).eq("status", "g3_review");
      if (dropErr) {
        console.error(`Failed to drop lead ${lead.id} after G3 resolution:`, dropErr.message);
        continue;
      }
      await logLeadActivity(adminClient, lead.id, caller.id, "md", "g3_dropped", "g3_review", "pa_dropped", `Dropped — ${accepted.lead_number} was accepted instead at G3 review.`);
      await notifyUsers(adminClient, [lead.created_by, lead.person_responsible_id], {
        title: "Lead dropped after G3 review",
        sub_text: `${lead.lead_number} — "${lead.title}" was dropped — another team's lead was selected at G3 review.`,
        type: "info",
        link: `/leads/${lead.id}`,
      });
    }

    const { error: resolveErr } = await adminClient
      .from("lead_g3_escalations")
      .update({ status: "resolved", accepted_lead_id: accepted.id, resolved_by_id: caller.id, resolved_at: new Date().toISOString() })
      .eq("id", escalationId)
      .eq("status", "open");
    if (resolveErr) console.error("Failed to mark G3 escalation resolved:", resolveErr.message);

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
