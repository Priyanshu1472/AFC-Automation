// supabase/functions/_shared/proposalFinance.ts
// Helpers shared by the Proposal money steps that sit after the MD approves
// the Bid Payment Requisition Note: Accounts making the payment
// (mark-fee-note-paid), and the EMD refund / PBG conversion after the
// client's response (proposal-emd-action) — plus the notifications that
// tie the lead's team and the Accounts Committee together.
//
// Accounts membership is just "Accounts" in the same multi-committee set
// as PMT/G3 (afc_user_committees) — read here rather than off
// getCallerProfile()'s own `committees`, since the two edge functions that
// need this (mark-fee-note-paid, proposal-emd-action) look it up for
// users OTHER than the caller too (getAccountsMemberIds, for notification
// fan-out), not just the caller's own membership.

import { createAdminClient } from "./auth.ts";
import { notifyUsers, type NotifyPayload } from "./notify.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

// Notification kinds, so a step's pending "action_required" alerts can be
// cleared for everyone once someone has acted on it.
export const KIND_ACCOUNTS = "proposal_accounts";
export const KIND_EMD = "proposal_emd";
export const KIND_PBG = "proposal_pbg";
export const KIND_FEE_PROOF = "proposal_fee_proof";

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
    const { data: user, error: userErr } = await admin.from("afc_users").select("is_active").eq("id", userId).maybeSingle();
    if (userErr || !user?.is_active) return false;
    const { data, error } = await admin.from("afc_user_committees").select("user_id").eq("user_id", userId).eq("committee", "Accounts").maybeSingle();
    if (error) {
      console.error("Accounts committee lookup failed:", error.message);
      return false;
    }
    return !!data;
  } catch (err) {
    console.error("Accounts committee lookup failed:", (err as Error).message);
    return false;
  }
}

export async function getAccountsMemberIds(admin: AdminClient): Promise<string[]> {
  try {
    const { data: committeeRows, error } = await admin.from("afc_user_committees").select("user_id").eq("committee", "Accounts");
    if (error) {
      console.error("Accounts Committee lookup failed:", error.message);
      return [];
    }
    const ids = [...new Set((committeeRows || []).map((r: { user_id: string }) => r.user_id).filter(Boolean))];
    if (!ids.length) return [];
    const { data: activeRows, error: activeErr } = await admin.from("afc_users").select("id").in("id", ids).eq("is_active", true);
    if (activeErr) {
      console.error("Accounts Committee lookup failed:", activeErr.message);
      return [];
    }
    return (activeRows || []).map((u: { id: string }) => u.id);
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

// Additional Persons Responsible on the proposal itself
// (proposal_additional_responsibles) — same access as the Person
// Responsible, so they act and get notified alongside the named three.
export async function getAdditionalResponsibleIds(admin: AdminClient, proposalId: string): Promise<string[]> {
  try {
    const { data, error } = await admin.from("proposal_additional_responsibles").select("user_id").eq("proposal_id", proposalId);
    if (error) {
      console.error("additional responsibles lookup failed:", error.message);
      return [];
    }
    return Array.isArray(data) ? data.map((r: { user_id: string }) => r.user_id).filter(Boolean) : [];
  } catch (err) {
    console.error("additional responsibles lookup failed:", (err as Error).message);
    return [];
  }
}

// PR / Reviewer / RA plus any additional Person Responsible.
export async function proposalTeamIds(admin: AdminClient, proposalId: string, lead: ProposalLead): Promise<string[]> {
  return [...new Set([...teamIds(lead), ...(await getAdditionalResponsibleIds(admin, proposalId))])];
}

export async function getMdIds(admin: AdminClient): Promise<string[]> {
  try {
    const { data, error } = await admin.from("afc_users").select("id").eq("role", "md").eq("is_active", true);
    if (error) {
      console.error("MD lookup failed:", error.message);
      return [];
    }
    return Array.isArray(data) ? data.map((u: { id: string }) => u.id) : [];
  } catch (err) {
    console.error("MD lookup failed:", (err as Error).message);
    return [];
  }
}

// Removes every proof of one purpose on a proposal — rows and the stored
// files. Best-effort on storage: the rows going is what the page reads.
export async function deleteFinanceFiles(admin: AdminClient, proposalId: string, purpose: string): Promise<void> {
  const { data: rows, error } = await admin.from("proposal_finance_files").select("id, file_path").eq("proposal_id", proposalId).eq("purpose", purpose);
  if (error) throw new Error(error.message);
  const list = Array.isArray(rows) ? rows as { id: string; file_path: string }[] : [];
  if (!list.length) return;
  const { error: delErr } = await admin.from("proposal_finance_files").delete().eq("proposal_id", proposalId).eq("purpose", purpose);
  if (delErr) throw new Error(delErr.message);
  try {
    await admin.storage.from("proposal-finance").remove(list.map((r) => r.file_path));
  } catch (err) {
    console.error("proof file removal from storage failed:", (err as Error).message);
  }
}

export async function countFinanceFiles(admin: AdminClient, proposalId: string, purpose: string): Promise<number> {
  const { count } = await admin.from("proposal_finance_files").select("id", { count: "exact", head: true })
    .eq("proposal_id", proposalId).eq("purpose", purpose);
  return count || 0;
}

// Every internal user — i.e. not a Business Partner, an outside identity —
// gets view access to any proposal (actions stay gated to the lead's own
// named assignees or md/admin); see 20261117010000_org_wide_internal_
// proposal_view.sql for the matching RLS-side change.
export function isInternalRole(caller: { role: string }): boolean {
  return caller.role !== "business_associate";
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
  row: { proposal_id: string; scope: "fee_payment" | "emd" | "pbg"; action: string; remark?: string | null; actor_id: string },
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
