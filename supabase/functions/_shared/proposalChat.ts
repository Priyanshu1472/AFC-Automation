// supabase/functions/_shared/proposalChat.ts
// Roster helper for the per-proposal chat (20260909000000_proposal_chat.sql)
// — a proposal has no committee pipeline like a lead does, so unlike
// addLeadChatParticipants (called repeatedly as a lead advances through
// stages), this is only ever called once, at creation, in
// create-proposal-preparation.

import { createAdminClient } from "./auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

// Bulk-adds the given users to a proposal's chat roster
// (proposal_chat_participants) — upsert with ignoreDuplicates so calling
// this again for an already-open proposal (e.g. a second "Open Proposal"
// visit) is a no-op rather than an error.
export async function addProposalChatParticipants(admin: AdminClient, proposalId: string, userIds: string[], roleAtAdd: string): Promise<void> {
  const rows = [...new Set(userIds)].filter(Boolean).map((user_id) => ({ proposal_id: proposalId, user_id, role_at_add: roleAtAdd }));
  if (!rows.length) return;
  const { error } = await admin.from("proposal_chat_participants").upsert(rows, { onConflict: "proposal_id,user_id", ignoreDuplicates: true });
  if (error) console.error("addProposalChatParticipants failed:", error.message);
}
