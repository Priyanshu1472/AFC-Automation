// supabase/functions/proposal-finance-daily/index.ts
// verify_jwt = false — called once a day by pg_cron through pg_net
// (public.run_proposal_finance_daily, 20261118000000), authenticated by the
// shared x-cron-secret header (CRON_SECRET function secret = the
// "cron_secret" Vault entry the cron job sends).
//
// Bid Payment Requisition Note payment proof: once the MD has approved the
// note and it's with Accounts, either Accounts or the lead's own team can
// upload the payment proof. Until someone does:
//   - every day before the lead's submission date, the Person Responsible,
//     Reviewer, Recommending Authority (and any additional Person
//     Responsible) plus the Accounts Committee get an in-app reminder;
//   - on the submission date (or the first run after it, if a day was
//     missed) the PR, Reviewer and RA get one email — once only.
// Each note is reminded at most once per day (fee_notes.proof_reminded_on)
// and emailed at most once (fee_notes.proof_deadline_emailed_at).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/auth.ts";
import { notifyUsers, emailUser } from "../_shared/notify.ts";
import { escapeHtml, wrapEmailBody } from "../_shared/email.ts";
import {
  KIND_FEE_PROOF, getAccountsMemberIds, getAdditionalResponsibleIds, teamIds, leadRef, proposalLink,
  type ProposalLead,
} from "../_shared/proposalFinance.ts";

// YYYY-MM-DD in India time — the reminders are about Indian working days.
export function istDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

type LeadRow = ProposalLead & { submission_deadline: string | null };

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient(), now: Date = new Date()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const expected = Deno.env.get("CRON_SECRET") || "";
  const given = req.headers.get("x-cron-secret") || "";
  if (!expected || given !== expected) return jsonRes(req, 401, { error: "Unauthorized" });

  const today = istDate(now);
  let reminded = 0;
  let emailed = 0;

  try {
    const { data: notes, error } = await adminClient
      .from("fee_notes")
      .select("id, proposal_id, proof_reminded_on, proof_deadline_emailed_at")
      .eq("status", "approved")
      .eq("payment_status", "pending");
    if (error) throw new Error(error.message);

    const accountsIds = (notes || []).length ? await getAccountsMemberIds(adminClient) : [];
    const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");

    for (const note of (notes || []) as { id: string; proposal_id: string; proof_reminded_on: string | null; proof_deadline_emailed_at: string | null }[]) {
      const { count } = await adminClient.from("proposal_finance_files").select("id", { count: "exact", head: true })
        .eq("proposal_id", note.proposal_id).eq("purpose", "fee_payment");
      if ((count || 0) > 0) continue;

      const { data: proposal } = await adminClient.from("proposal_preparations").select("lead_id").eq("id", note.proposal_id).maybeSingle();
      if (!proposal) continue;
      const { data: lead } = await adminClient
        .from("leads")
        .select("id, lead_number, title, person_responsible_id, reviewer_id, recommending_authority_id, submission_deadline")
        .eq("id", proposal.lead_id)
        .maybeSingle() as { data: LeadRow | null };
      if (!lead) continue;

      const deadline = lead.submission_deadline ? istDate(new Date(lead.submission_deadline)) : null;
      const link = proposalLink(lead);
      const ref = leadRef(lead);

      if ((!deadline || today < deadline) && note.proof_reminded_on !== today) {
        const additional = await getAdditionalResponsibleIds(adminClient, note.proposal_id);
        await notifyUsers(adminClient, [...teamIds(lead), ...additional, ...accountsIds], {
          title: "Payment proof not uploaded yet",
          sub_text: `${ref}: the Bid Payment Requisition Note is approved but no payment proof has been uploaded.${deadline ? ` Submission date: ${deadline.split("-").reverse().join(".")}.` : ""} Upload it on the proposal page.`,
          type: "action_required",
          link,
          kind: KIND_FEE_PROOF,
        });
        await adminClient.from("fee_notes").update({ proof_reminded_on: today }).eq("id", note.id);
        reminded += 1;
      }

      if (deadline && today >= deadline && !note.proof_deadline_emailed_at) {
        const html = wrapEmailBody(`
          <p style="margin:0 0 12px;font-size:15px;color:#111827;font-weight:600;">Payment proof still missing — submission date reached</p>
          <p style="margin:0 0 12px;font-size:14px;color:#374151;">
            The Bid Payment Requisition Note for <strong>${escapeHtml(lead.lead_number)} — ${escapeHtml(lead.title)}</strong>
            was approved by the MD, but no payment proof has been uploaded, and today is the submission date
            (${escapeHtml(deadline.split("-").reverse().join("."))}).
          </p>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;">Please upload the payment proof on the proposal page, or check with the Accounts Committee.</p>
          ${siteUrl ? `<p style="margin:0;"><a href="${escapeHtml(siteUrl + link)}" style="display:inline-block;background:#1a5fd4;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">Open the proposal</a></p>` : ""}
        `);
        for (const id of teamIds(lead)) {
          await emailUser(adminClient, id, { subject: `Payment proof missing — ${lead.lead_number}`, html });
        }
        await notifyUsers(adminClient, teamIds(lead), {
          title: "Submission date reached — payment proof still missing",
          sub_text: `${ref}: today is the submission date and the payment proof for the Bid Payment Requisition Note hasn't been uploaded.`,
          type: "action_required",
          link,
          kind: KIND_FEE_PROOF,
        });
        await adminClient.from("fee_notes").update({ proof_deadline_emailed_at: now.toISOString() }).eq("id", note.id);
        emailed += 1;
      }
    }

    return jsonRes(req, 200, { success: true, reminded, emailed });
  } catch (err) {
    console.error("proposal-finance-daily failed:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
