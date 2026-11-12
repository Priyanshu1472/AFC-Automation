// supabase/functions/_shared/proposalAuth.ts
// Mirrors the DB's can_edit_proposal() SQL function (20260928000100,
// widened by 20261112000000_proposal_additional_responsibles) so
// add-proposal-responsible and remove-proposal-responsible can check the
// same gate before writing via the admin client, which bypasses RLS
// entirely — those functions can't just rely on the table's own INSERT/
// DELETE policies the way a plain client write would.

import { createAdminClient } from "./auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

type Lead = {
  id: string;
  lead_number: string;
  title: string;
  status: string;
  team: string | null;
  submission_deadline: string | null;
  person_responsible_id: string | null;
  reviewer_id: string | null;
  recommending_authority_id: string | null;
};

type Proposal = { id: string; lead_id: string; locked: boolean };

export type ProposalEditCheck =
  | { ok: true; proposal: Proposal; lead: Lead }
  | { ok: false; status: number; error: string };

export async function checkCanEditProposal(
  admin: AdminClient,
  leadId: string,
  caller: { id: string; role: string }
): Promise<ProposalEditCheck> {
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, lead_number, title, status, team, submission_deadline, person_responsible_id, reviewer_id, recommending_authority_id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, status: 404, error: "Lead not found." };

  const { data: proposal, error: proposalErr } = await admin
    .from("proposal_preparations")
    .select("id, lead_id, locked")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (proposalErr || !proposal) return { ok: false, status: 404, error: "Proposal not found. Open it first." };

  const deadlinePassed = !!lead.submission_deadline && new Date(lead.submission_deadline) < new Date();
  if (proposal.locked || deadlinePassed) return { ok: false, status: 400, error: "This proposal is locked." };

  const isNamed =
    ["md", "admin"].includes(caller.role) ||
    [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(caller.id);

  if (!isNamed) {
    const { data: already } = await admin
      .from("proposal_additional_responsibles")
      .select("id")
      .eq("proposal_id", proposal.id)
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!already) return { ok: false, status: 403, error: "You don't have permission to manage this proposal's team." };
  }

  return { ok: true, proposal, lead };
}
