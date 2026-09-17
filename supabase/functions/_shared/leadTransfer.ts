// supabase/functions/_shared/leadTransfer.ts
// Moves a lead to a different team, PMT-initiated — shared between
// transfer-lead (standalone) and respond-lead-query's "transfer" action so
// the two entry points can't drift. Works at any lead status, including
// terminal ones (md_approved/md_declined/pa_dropped) — a lead can be
// transferred even after MD approval, per product decision; any downstream
// Proposal Preparation/Fee Note already created stays tied to the old
// lead_id/team as-is (deliberately not touched or migrated).
//
// Resets the lead to a fresh pa_review, as if it were being created again
// for the new team: Person Responsible/Reviewer/Recommending Authority/
// Business Partner all cleared (the new team names its own — that's why
// those three columns had their NOT NULL constraint dropped, see
// 20260928000100), and every Lead Approval Note / PR-review flag cleared
// so the note process restarts from scratch under the new team.

import { createAdminClient } from "./auth.ts";
import { logLeadActivity } from "./leadActivity.ts";
import { notifyUsers, notifyTeam } from "./notify.ts";
import { getOrgWideHolders } from "./leadAuth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export type TransferResult = { ok: true; leadNumber: string } | { ok: false; error: string };

export async function performLeadTransfer(
  admin: AdminClient,
  leadId: string,
  targetTeam: string,
  justification: string,
  actorId: string
): Promise<TransferResult> {
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, lead_number, title, team, status, transfer_count")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, error: "Lead not found." };

  if (targetTeam === lead.team) return { ok: false, error: "This lead is already on that team." };

  const { data: teamCheck, error: teamErr } = await admin
    .from("afc_users")
    .select("id")
    .eq("team", targetTeam)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (teamErr || !teamCheck) return { ok: false, error: "Target team not found." };

  const fromTeam = lead.team as string;

  const { error: updateErr } = await admin
    .from("leads")
    .update({
      team: targetTeam,
      status: "pa_review",
      person_responsible_id: null,
      reviewer_id: null,
      recommending_authority_id: null,
      assigned_ba_id: null,
      handled_by_dgm_id: null,
      declined_from_status: null,
      approval_note_data: null,
      approval_note_pr_reviewed: false,
      approval_note_pending_pr_review: false,
      chat_opened_at: null,
      transferred_from_team: fromTeam,
      transfer_count: (lead.transfer_count as number) + 1,
    })
    .eq("id", leadId);
  if (updateErr) {
    console.error("Lead transfer update failed:", updateErr.message);
    return { ok: false, error: "Failed to transfer lead. Please try again." };
  }

  await logLeadActivity(admin, leadId, actorId, "pmt", "team_transfer", lead.status as string, "pa_review", `${fromTeam} → ${targetTeam}. ${justification}`);

  // Team 2 (actionable — they now own a lead with no PR/Reviewer/
  // Recommending Authority named yet), Team 1 (informational), and MD
  // (informational — MD/PMT effectively see everything anyway now).
  await Promise.all([
    notifyTeam(admin, targetTeam, {
      title: "A lead was transferred to your team",
      sub_text: `${lead.lead_number} — "${lead.title}" was transferred from ${fromTeam}. Assign a Person Responsible, Reviewer, and Recommending Authority to continue it.`,
      type: "action_required",
      link: `/leads/${leadId}`,
    }),
    notifyTeam(admin, fromTeam, {
      title: "A lead was transferred out of your team",
      sub_text: `${lead.lead_number} — "${lead.title}" was transferred to ${targetTeam}.`,
      type: "info",
      link: `/leads/${leadId}`,
    }),
    getOrgWideHolders(admin, { role: "md" }).then((mdHolders) =>
      notifyUsers(admin, mdHolders, {
        title: "A lead was transferred between teams",
        sub_text: `${lead.lead_number} — "${lead.title}" moved from ${fromTeam} to ${targetTeam}.`,
        type: "info",
        link: `/leads/${leadId}`,
      })
    ),
  ]);

  return { ok: true, leadNumber: lead.lead_number as string };
}
