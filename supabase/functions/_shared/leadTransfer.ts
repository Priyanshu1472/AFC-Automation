// supabase/functions/_shared/leadTransfer.ts
// Moves a lead to a different team, PMT-initiated — used by
// respond-lead-query's "transfer" action, the only way a lead gets
// transferred (there is no standalone/free-transfer entry point; PMT can
// only act once another team has raised a cross-team query on the lead).
// Works at any lead status, including
// terminal ones (md_approved/md_declined/pa_dropped) — a lead can be
// transferred even after MD approval, per product decision; any downstream
// Proposal Preparation/Fee Note already created stays tied to the old
// lead_id/team as-is (deliberately not touched or migrated).
//
// Resets the lead to po_assignment, as if it were being created again by an
// Associate Consultant/Project Assistant for the new team (see create-lead's
// isPoRouted): Person Responsible/Reviewer/Recommending Authority/Business
// Partner all cleared (the new team names its own — that's why those three
// columns had their NOT NULL constraint dropped, see 20260928000100), every
// Lead Approval Note / PR-review flag cleared so the note process restarts
// from scratch, and the chat roster wiped so the old team's participants
// don't linger once the new team's chat reopens.

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
      status: "po_assignment",
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

  // The old team's chat roster has no business being on the new team's
  // thread — chat_opened_at is already cleared above, but the participant
  // rows themselves need wiping too, or the old team would silently regain
  // visibility the moment the new team's chat reopens.
  const { error: chatClearErr } = await admin.from("lead_chat_participants").delete().eq("lead_id", leadId);
  if (chatClearErr) console.error("Clearing lead_chat_participants after transfer failed:", chatClearErr.message);

  await logLeadActivity(admin, leadId, actorId, "pmt", "team_transfer", lead.status as string, "po_assignment", `${fromTeam} → ${targetTeam}. ${justification}`);

  // The new team's PO tier (actionable — same audience/wording as
  // create-lead's isPoRouted notification, since this is now the exact
  // same po_assignment state), the old team (informational), and MD
  // (informational — MD/PMT effectively see everything anyway now).
  const { data: poTier } = await admin
    .from("afc_users")
    .select("id")
    .eq("team", targetTeam)
    .eq("is_active", true)
    .in("role", ["project_officer", "area_manager", "regional_manager"]);

  await Promise.all([
    notifyUsers(admin, (poTier || []).map((u: { id: string }) => u.id), {
      title: "A lead was transferred to your team",
      sub_text: `${lead.lead_number} — "${lead.title}" was transferred from ${fromTeam} and needs a Person Responsible, Reviewer, and Recommending Authority assigned.`,
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
