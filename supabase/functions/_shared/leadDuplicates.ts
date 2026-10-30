// supabase/functions/_shared/leadDuplicates.ts
// Org-wide possible-duplicate lookup for create-lead/update-lead — the
// form already warned the user and they chose to save anyway, so this
// records which leads matched on leads.possible_duplicate_ids for the lead
// page to show (see 20261030030000_lead_duplicates_org_wide.sql). Checks
// every attached document, not just the first one the form's live hint
// uses. Best-effort: a lookup failure never blocks saving the lead.

import { createAdminClient } from "./auth.ts";

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
