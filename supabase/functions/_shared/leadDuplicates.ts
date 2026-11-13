// supabase/functions/_shared/leadDuplicates.ts
// Org-wide possible-duplicate lookup for create-lead/update-lead — the
// form already warned the user and they chose to save anyway, so this
// records which leads matched on leads.possible_duplicate_ids for the lead
// page to show (see 20261030030000_lead_duplicates_org_wide.sql). Checks
// every attached document, not just the first one the form's live hint
// uses. Best-effort: a lookup failure never blocks saving the lead.

import { createAdminClient } from "./auth.ts";
import { notifyUsers } from "./notify.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function findPossibleDuplicateIds(
  admin: AdminClient,
  input: { title: string; bidNumber: string | null; documents: Array<{ name: string; size: number }>; excludeId?: string }
): Promise<string[]> {
  const docs = input.documents.length ? input.documents : [null];
  const results = await Promise.all(
    docs.map((d) =>
      admin.rpc("find_similar_leads", {
        p_title: input.title,
        p_bid_number: input.bidNumber || null,
        p_document_name: d?.name ?? null,
        p_document_size: d?.size ?? null,
        p_exclude_id: input.excludeId ?? null,
      })
    )
  );
  const ids = new Set<string>();
  for (const { data, error } of results) {
    if (error) {
      console.error("find_similar_leads failed:", error.message);
      continue;
    }
    for (const row of (data as Array<{ id: string }> | null) || []) ids.add(row.id);
  }
  return [...ids];
}

// A possible-duplicate flag used to land only on the lead actively being
// saved — the earlier, already-existing lead(s) it matched never got
// flagged or told. This back-links the new lead onto every matched lead's
// own possible_duplicate_ids (so its own page shows the same banner) and
// notifies its stakeholders. `newlyMatchedIds` should already be narrowed
// to IDs not present before this save (both callers do this by diffing
// against the lead's previous possible_duplicate_ids) — on an edit that
// still matches the same leads it already matched before, nobody needs a
// second notification. Best-effort throughout: never blocks the save.
export async function linkAndNotifyReciprocalDuplicates(
  admin: AdminClient,
  opts: { newLeadId: string; newLeadNumber: string; newLeadTitle: string; newLeadTeam: string; newlyMatchedIds: string[] }
): Promise<void> {
  if (!opts.newlyMatchedIds.length) return;
  try {
    const { data: matchedLeads, error } = await admin
      .from("leads")
      .select("id, possible_duplicate_ids, created_by, person_responsible_id, reviewer_id, recommending_authority_id, handled_by_dgm_id")
      .in("id", opts.newlyMatchedIds);
    if (error || !matchedLeads) {
      console.error("linkAndNotifyReciprocalDuplicates lookup failed:", error?.message);
      return;
    }
    for (const lead of matchedLeads as Array<{
      id: string;
      possible_duplicate_ids: string[] | null;
      created_by: string | null;
      person_responsible_id: string | null;
      reviewer_id: string | null;
      recommending_authority_id: string | null;
      handled_by_dgm_id: string | null;
    }>) {
      const existing = lead.possible_duplicate_ids || [];
      if (!existing.includes(opts.newLeadId)) {
        const { error: updErr } = await admin
          .from("leads")
          .update({ possible_duplicate_ids: [...existing, opts.newLeadId] })
          .eq("id", lead.id);
        if (updErr) console.error(`Failed to back-link duplicate onto lead ${lead.id}:`, updErr.message);
      }
      await notifyUsers(
        admin,
        [lead.created_by, lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id, lead.handled_by_dgm_id],
        {
          title: "Possible duplicate lead added",
          sub_text: `A possible duplicate was added by ${opts.newLeadTeam} — ${opts.newLeadNumber}${opts.newLeadTitle ? ` ("${opts.newLeadTitle}")` : ""}.`,
          type: "info",
          link: `/leads/${lead.id}`,
        }
      );
    }
  } catch (err) {
    console.error("linkAndNotifyReciprocalDuplicates failed:", (err as Error).message);
  }
}
