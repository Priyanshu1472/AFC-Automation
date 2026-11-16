// supabase/functions/_shared/proposalFinance.ts
// Helpers shared by the Proposal money steps that sit after the MD approves
// the Bid Payment Requisition Note: Accounts making the payment
// (mark-fee-note-paid), and the EMD refund / PBG conversion after the
// client's response (proposal-emd-action) — plus the notifications that
// tie the lead's team and the Accounts Committee together.
//
// Accounts membership is read here, not in getCallerProfile(), so a
// database without the accounts_committee column (migration not yet
// promoted) can never break every other edge function's caller lookup.

import { createAdminClient } from "./auth.ts";
import { notifyUsers, type NotifyPayload } from "./notify.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

// Notification kinds, so a step's pending "action_required" alerts can be
// cleared for everyone once someone has acted on it.
export const KIND_ACCOUNTS = "proposal_accounts";
export const KIND_EMD = "proposal_emd";

export type ProposalLead = {
  id: string;
  lead_number: string;
  title: string;
  person_responsible_id: string | null;
  reviewer_id: string | null;
  recommending_authority_id: string | null;
};

export type ProposalRow = { id: string; lead_id: string; locked: boolean; client_response: string };

export async function isAccountsMember(admin: AdminClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from("afc_users").select("accounts_committee, is_active").eq("id", userId).maybeSingle();
    if (error) {
      console.error("accounts_committee lookup failed:", error.message);
      return false;
    }
    return !!data?.is_active && data?.accounts_committee === true;
  } catch (err) {
    console.error("accounts_committee lookup failed:", (err as Error).message);
    return false;
  }
}

export async function getAccountsMemberIds(admin: AdminClient): Promise<string[]> {
  try {
    const { data, error } = await admin.from("afc_users").select("id").eq("accounts_committee", true).eq("is_active", true);
    if (error) {
      console.error("Accounts Committee lookup failed:", error.message);
      return [];
    }
    return Array.isArray(data) ? data.map((u: { id: string }) => u.id).filter(Boolean) : [];
  } catch (err) {
    console.error("Accounts Committee lookup failed:", (err as Error).message);
    return [];
  }
}

// Best-effort, like every notification: never fails the caller's action.
export async function notifyAccountsCommittee(admin: AdminClient, payload: NotifyPayload) {
  const ids = await getAccountsMemberIds(admin);
  await notifyUsers(admin, ids, { ...payload, kind: payload.kind ?? KIND_ACCOUNTS });
}

export function teamIds(lead: ProposalLead): string[] {
  return [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].filter((id): id is string => !!id);
}

export function isLeadTeam(lead: ProposalLead, callerId: string): boolean {
  return teamIds(lead).includes(callerId);
}

// "AFC/TEAM 1/L/26/022 — "Title"" — the shape notificationDisplay.js
// parses into a lead reference + subject.
export function leadRef(lead: ProposalLead): string {
  return `${lead.lead_number} — "${lead.title}"`;
}

export function proposalLink(lead: ProposalLead): string {
  return `/proposals/${lead.id}`;
}

// Marks every still-unread alert of this kind for this proposal as read, so
// it drops off everyone's Home "needs your action" list once one person has
// handled it.
export async function clearPendingAlerts(admin: AdminClient, link: string, kind: string) {
  try {
    await admin.from("notifications").update({ is_read: true }).eq("link", link).eq("kind", kind).eq("is_read", false);
  } catch (err) {
    console.error("clearPendingAlerts failed:", (err as Error).message);
  }
}

export async function logFinanceEvent(
  admin: AdminClient,
  row: { proposal_id: string; scope: "fee_payment" | "emd"; action: string; remark?: string | null; actor_id: string },
) {
  const { error } = await admin.from("proposal_finance_events").insert({ ...row, remark: row.remark || null });
  if (error) console.error("proposal_finance_events insert failed:", error.message);
}

export async function loadProposalAndLead(
  admin: AdminClient,
  proposalId: string,
): Promise<{ ok: true; proposal: ProposalRow; lead: ProposalLead } | { ok: false; status: number; error: string }> {
  const { data: proposal, error: propErr } = await admin
    .from("proposal_preparations")
    .select("id, lead_id, locked, client_response")
    .eq("id", proposalId)
    .maybeSingle();
  if (propErr || !proposal) return { ok: false, status: 404, error: "Proposal not found." };
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, lead_number, title, person_responsible_id, reviewer_id, recommending_authority_id")
    .eq("id", proposal.lead_id)
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, status: 404, error: "Lead not found." };
  return { ok: true, proposal, lead };
}

export function cleanRemark(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function rupees(n: number | string | null | undefined): string {
  if (n == null || n === "") return "₹0";
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
