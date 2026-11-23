// supabase/functions/proposal-pbg-note/index.ts
// JWT must be ON. The PBG Note on an awarded proposal (proposal_pbg_notes)
// — one per proposal:
//
//   save                  team, draft only — PBG amount, consultancy fee and
//                         the editable wording (content). Creates the note
//                         the first time. The EMD adjusted is re-derived
//                         from the EMD track: the EMD when it's "Converted
//                         to PBG", otherwise 0 (refunded / on completion /
//                         no EMD) — which is what picks the note's wording.
//   forward       (PIN)   Person Responsible / Reviewer / additional PR,
//                         draft -> pending_ra, or straight back to the stage
//                         that asked for a clarification (return_to).
//                         Needs at least one proof and a remark. Signs as
//                         Person Responsible.
//   ra_approve    (PIN)   the lead's Recommending Authority, pending_ra -> pending_md
//   md_approve    (PIN)   MD, pending_md -> pending_accounts (Accounts join the chat)
//   accounts_approve (PIN) Accounts Committee, pending_accounts -> pending_payment
//   mark_paid     (PIN)   Accounts or the team, pending_payment -> completed
//                         ("PBG Done") — needs the payment proof uploaded.
//                         A converted EMD's tracking completes with it.
//   request_clarification RA at pending_ra / MD at pending_md / Accounts at
//                         pending_accounts -> draft with return_to = that
//                         stage, remark required.
//
// No admin/MD stand-in for the PR / RA signatures — their names print on
// the note, same rule as the Bid Payment Requisition Note.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { moduleOffResponse } from "../_shared/modules.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { verifyActionPin } from "../_shared/pin.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { addProposalChatParticipants } from "../_shared/proposalChat.ts";
import {
  KIND_ACCOUNTS, KIND_PBG, isAccountsMember, loadProposalAndLead, notifyAccountsCommittee, getAccountsMemberIds,
  leadRef, proposalLink, clearPendingAlerts, logFinanceEvent, cleanRemark, rupees,
  proposalTeamIds, getAdditionalResponsibleIds, getMdIds, countFinanceFiles, isProjectAward,
} from "../_shared/proposalFinance.ts";

const ACTIONS = new Set(["save", "forward", "ra_approve", "md_approve", "accounts_approve", "mark_paid", "request_clarification"]);
const PIN_ACTIONS = new Set(["forward", "ra_approve", "md_approve", "accounts_approve", "mark_paid"]);
const STAGE_LABEL: Record<string, string> = {
  pending_ra: "Recommending Authority",
  pending_md: "MD",
  pending_accounts: "Accounts",
};
const PARAGRAPH_KEYS = ["award", "partner", "requirement", "emd", "delivery", "closing"];
const FIELD_KEYS = ["loa_reference", "loa_date", "pbg_percent", "instrument", "in_favour_of", "payable_at", "validity"];

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").slice(0, max) : "";
}

// Only the known keys, only strings, capped — the wording is free text the
// PDF prints verbatim.
function cleanContent(raw: unknown) {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p = (c.paragraphs && typeof c.paragraphs === "object" ? c.paragraphs : {}) as Record<string, unknown>;
  const f = (c.fields && typeof c.fields === "object" ? c.fields : {}) as Record<string, unknown>;
  const d = (c.dirty && typeof c.dirty === "object" ? c.dirty : {}) as Record<string, unknown>;
  return {
    subject: cleanText(c.subject, 600),
    paragraphs: Object.fromEntries(PARAGRAPH_KEYS.map((k) => [k, cleanText(p[k], 4000)])),
    enclosures: cleanText(c.enclosures, 1000),
    fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, cleanText(f[k], 300)])),
    dirty: Object.fromEntries(Object.entries(d).filter(([, v]) => v === true).slice(0, 20)),
  };
}

function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : NaN;
}

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  const moduleOff = await moduleOffResponse(req, "proposals");
  if (moduleOff) return moduleOff;
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes(req, 400, { error: "Invalid JSON body." });
  }

  const proposalId = body.proposal_id;
  const action = body.action;
  if (typeof proposalId !== "string" || !proposalId) return jsonRes(req, 400, { error: "proposal_id is required." });
  if (typeof action !== "string" || !ACTIONS.has(action)) return jsonRes(req, 400, { error: "Invalid action." });
  const remark = cleanRemark(body.remark);

  try {
    const ctx = await loadProposalAndLead(adminClient, proposalId);
    if (!ctx.ok) return jsonRes(req, ctx.status, { error: ctx.error });
    const { proposal, lead } = ctx;
    if (!isProjectAward(proposal)) return jsonRes(req, 400, { error: "A PBG Note is only raised once the project itself is awarded." });

    const link = proposalLink(lead);
    const ref = leadRef(lead);
    const additional = await getAdditionalResponsibleIds(adminClient, proposalId);
    const team = await proposalTeamIds(adminClient, proposalId, lead);
    const preparers = [lead.person_responsible_id, lead.reviewer_id, ...additional].filter((id): id is string => !!id);
    const isPreparer = preparers.includes(caller.id);
    const isRA = caller.id === lead.recommending_authority_id;
    const isMd = caller.role === "md";
    const accounts = action === "accounts_approve" || action === "mark_paid" || action === "request_clarification"
      ? await isAccountsMember(adminClient, caller.id)
      : false;

    const { data: note } = await adminClient.from("proposal_pbg_notes").select("*").eq("proposal_id", proposalId).maybeSingle();

    // The EMD side: what was deposited, and how much of it this PBG absorbs.
    const [{ data: feeNote }, { data: tracking }] = await Promise.all([
      adminClient.from("fee_notes").select("emd_amount").eq("proposal_id", proposalId).eq("status", "approved").maybeSingle(),
      adminClient.from("proposal_emd_tracking").select("id, track, status").eq("proposal_id", proposalId).maybeSingle(),
    ]);
    const emd = Number(feeNote?.emd_amount) > 0 ? Number(feeNote!.emd_amount) : 0;
    const adjustedFor = (pbg: number) => (tracking?.track === "pbg" ? Math.min(emd, pbg) : 0);

    // PIN is checked only after the role/state checks below pass, so a
    // click on the wrong stage never counts as a failed PIN attempt.
    const pinFail = async () => {
      if (!PIN_ACTIONS.has(action)) return null;
      const pinErr = await verifyActionPin(adminClient, caller.id, caller.pin_hash, body.pin);
      return pinErr ? jsonRes(req, 400, { error: pinErr }) : null;
    };

    // ── save ────────────────────────────────────────────────────────
    if (action === "save") {
      if (!(isPreparer || team.includes(caller.id) || ["md", "admin"].includes(caller.role))) {
        return jsonRes(req, 403, { error: "Only this lead's Person Responsible, Reviewer or Recommending Authority can prepare the PBG Note." });
      }
      if (note && note.status !== "draft") return jsonRes(req, 400, { error: "The PBG Note has been forwarded — it can't be edited now." });
      const pbg = money(body.pbg_amount);
      if (pbg === null || Number.isNaN(pbg)) return jsonRes(req, 400, { error: "Enter the PBG amount." });
      const fee = money(body.consultancy_fee);
      if (Number.isNaN(fee)) return jsonRes(req, 400, { error: "Enter a valid consultancy fee, or leave it blank." });

      const row = {
        pbg_amount: pbg,
        consultancy_fee: fee,
        emd_amount: emd,
        emd_adjusted: adjustedFor(pbg as number),
        content: cleanContent(body.content),
        updated_at: new Date().toISOString(),
      };
      if (note) {
        const { error } = await adminClient.from("proposal_pbg_notes").update(row).eq("id", note.id).eq("status", "draft");
        if (error) throw new Error(error.message);
      } else {
        const { error } = await adminClient.from("proposal_pbg_notes").insert({ ...row, proposal_id: proposalId, created_by: caller.id });
        if (error) throw new Error(error.message);
        await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "pbg", action: "pbg_note_created", actor_id: caller.id });
      }
      return jsonRes(req, 200, { success: true });
    }

    if (!note) return jsonRes(req, 400, { error: "Create the PBG Note first." });

    const stamp = new Date().toISOString();
    const move = async (from: string, patch: Record<string, unknown>) => {
      const { data: upd, error } = await adminClient.from("proposal_pbg_notes")
        .update({ ...patch, updated_at: stamp }).eq("id", note.id).eq("status", from).select("id");
      if (error) throw new Error(error.message);
      return !!upd?.length;
    };
    const raced = () => jsonRes(req, 409, { error: "Someone else just acted on this note — refresh the page." });

    // ── forward ─────────────────────────────────────────────────────
    if (action === "forward") {
      if (!isPreparer) return jsonRes(req, 403, { error: "Only the Person Responsible or Reviewer can forward the PBG Note — it's signed in their name." });
      if (note.status !== "draft") return jsonRes(req, 400, { error: "The PBG Note isn't a draft." });
      if ((await countFinanceFiles(adminClient, proposalId, "pbg")) === 0) return jsonRes(req, 400, { error: "Upload at least one proof before forwarding." });
      if (!remark) return jsonRes(req, 400, { error: "Add a remark before forwarding." });
      const pinRes = await pinFail();
      if (pinRes) return pinRes;

      const next = note.return_to || "pending_ra";
      const ok = await move("draft", {
        status: next,
        return_to: null,
        remarks: remark,
        emd_amount: emd,
        emd_adjusted: adjustedFor(Number(note.pbg_amount)),
        pr_signed_by: caller.id,
        pr_signed_at: stamp,
      });
      if (!ok) return raced();
      await logFinanceEvent(adminClient, {
        proposal_id: proposalId, scope: "pbg",
        action: note.return_to ? "pbg_clarified" : "pbg_forwarded",
        remark, actor_id: caller.id,
      });
      await clearPendingAlerts(adminClient, link, KIND_PBG);

      const payload = {
        title: note.return_to ? "PBG Note clarified — back for your review" : "PBG Note awaiting your approval",
        sub_text: `${ref}: PBG of ${rupees(note.pbg_amount)}. "${remark}"`,
        type: "action_required",
        link,
        kind: KIND_PBG,
      };
      if (next === "pending_ra") await notifyUsers(adminClient, [lead.recommending_authority_id], payload);
      else if (next === "pending_md") await notifyUsers(adminClient, await getMdIds(adminClient), payload);
      else await notifyAccountsCommittee(adminClient, { ...payload, kind: KIND_PBG });
      return jsonRes(req, 200, { success: true });
    }

    // ── RA ──────────────────────────────────────────────────────────
    if (action === "ra_approve") {
      if (!isRA) return jsonRes(req, 403, { error: "Only this lead's Recommending Authority can approve here." });
      if (note.status !== "pending_ra") return jsonRes(req, 400, { error: "The PBG Note isn't waiting for the Recommending Authority." });
      const pinRes = await pinFail();
      if (pinRes) return pinRes;
      if (!(await move("pending_ra", { status: "pending_md", ra_signed_by: caller.id, ra_signed_at: stamp }))) return raced();
      await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "pbg", action: "pbg_ra_approved", remark, actor_id: caller.id });
      await clearPendingAlerts(adminClient, link, KIND_PBG);
      await notifyUsers(adminClient, await getMdIds(adminClient), {
        title: "PBG Note awaiting your approval",
        sub_text: `${ref}: the Recommending Authority approved the PBG Note (PBG ${rupees(note.pbg_amount)}).`,
        type: "action_required",
        link,
        kind: KIND_PBG,
      });
      await notifyUsers(adminClient, team.filter((id) => id !== caller.id), {
        title: "PBG Note sent to the MD",
        sub_text: `${ref}: the Recommending Authority approved the PBG Note and forwarded it to the MD.`,
        type: "info",
        link,
      });
      return jsonRes(req, 200, { success: true });
    }

    // ── MD ──────────────────────────────────────────────────────────
    if (action === "md_approve") {
      if (!isMd) return jsonRes(req, 403, { error: "Only the MD can approve here." });
      if (note.status !== "pending_md") return jsonRes(req, 400, { error: "The PBG Note isn't waiting for the MD." });
      const pinRes = await pinFail();
      if (pinRes) return pinRes;
      if (!(await move("pending_md", { status: "pending_accounts", md_signed_by: caller.id, md_signed_at: stamp }))) return raced();
      await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "pbg", action: "pbg_md_approved", remark, actor_id: caller.id });
      await clearPendingAlerts(adminClient, link, KIND_PBG);
      await addProposalChatParticipants(adminClient, proposalId, await getAccountsMemberIds(adminClient), "accounts", caller.id);
      await notifyAccountsCommittee(adminClient, {
        title: "PBG Note approved by the MD — review and pay",
        sub_text: `${ref}: PBG of ${rupees(note.pbg_amount)}${Number(note.emd_adjusted) > 0 ? ` (EMD ${rupees(note.emd_adjusted)} adjusted, ${rupees(Number(note.pbg_amount) - Number(note.emd_adjusted))} to be furnished)` : ""}. Check the note and proofs.`,
        type: "action_required",
        link,
        kind: KIND_PBG,
      });
      await notifyUsers(adminClient, team, {
        title: "PBG Note approved by the MD",
        sub_text: `${ref}: the MD approved the PBG Note. It's now with Accounts.`,
        type: "info",
        link,
      });
      return jsonRes(req, 200, { success: true });
    }

    // ── Accounts review ─────────────────────────────────────────────
    if (action === "accounts_approve") {
      if (!accounts) return jsonRes(req, 403, { error: "Only an Accounts Committee member can do this." });
      if (note.status !== "pending_accounts") return jsonRes(req, 400, { error: "The PBG Note isn't waiting for Accounts." });
      const pinRes = await pinFail();
      if (pinRes) return pinRes;
      if (!(await move("pending_accounts", { status: "pending_payment", accounts_reviewed_by: caller.id, accounts_reviewed_at: stamp, accounts_remark: remark || null }))) return raced();
      await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "pbg", action: "pbg_accounts_approved", remark, actor_id: caller.id });
      await clearPendingAlerts(adminClient, link, KIND_PBG);
      await notifyUsers(adminClient, team, {
        title: "PBG Note cleared by Accounts — payment pending",
        sub_text: `${ref}: Accounts reviewed the PBG Note. Once the PBG is paid, upload the proof and mark the payment done.`,
        type: "action_required",
        link,
        kind: KIND_PBG,
      });
      return jsonRes(req, 200, { success: true });
    }

    // ── Payment done ────────────────────────────────────────────────
    if (action === "mark_paid") {
      if (!(accounts || team.includes(caller.id) || ["md", "admin"].includes(caller.role))) {
        return jsonRes(req, 403, { error: "Only Accounts or this lead's team can record the PBG payment." });
      }
      if (note.status !== "pending_payment") return jsonRes(req, 400, { error: "The PBG Note isn't waiting for payment." });
      if ((await countFinanceFiles(adminClient, proposalId, "pbg_payment")) === 0) return jsonRes(req, 400, { error: "Upload the payment proof first." });
      const pinRes = await pinFail();
      if (pinRes) return pinRes;
      const reference = cleanRemark(body.payment_reference, 200);
      if (!(await move("pending_payment", {
        status: "completed", payment_done_by: caller.id, payment_done_at: stamp,
        payment_reference: reference || null, payment_remark: remark || null,
      }))) return raced();

      // A converted EMD is settled together with the PBG it was adjusted into.
      if (tracking?.track === "pbg" && tracking.status !== "completed") {
        await adminClient.from("proposal_emd_tracking")
          .update({ status: "completed", completed_at: stamp, completed_by: caller.id, pbg_amount: note.pbg_amount, updated_at: stamp })
          .eq("id", tracking.id);
      }
      await logFinanceEvent(adminClient, {
        proposal_id: proposalId, scope: "pbg", action: "pbg_paid",
        remark: [reference && `Ref: ${reference}`, remark].filter(Boolean).join(" — "), actor_id: caller.id,
      });
      await clearPendingAlerts(adminClient, link, KIND_PBG);
      await clearPendingAlerts(adminClient, link, KIND_ACCOUNTS);
      await notifyUsers(adminClient, [...team, ...(await getAccountsMemberIds(adminClient)), ...(await getMdIds(adminClient))].filter((id) => id !== caller.id), {
        title: "PBG Done",
        sub_text: `${ref}: the PBG of ${rupees(note.pbg_amount)} has been paid and the proof recorded.${reference ? ` Ref: ${reference}.` : ""}`,
        type: "info",
        link,
      });
      return jsonRes(req, 200, { success: true });
    }

    // ── request_clarification ───────────────────────────────────────
    const stage = note.status as string;
    const allowedHere = (stage === "pending_ra" && isRA) || (stage === "pending_md" && isMd) || (stage === "pending_accounts" && accounts);
    if (!STAGE_LABEL[stage]) return jsonRes(req, 400, { error: "The PBG Note isn't waiting for a review." });
    if (!allowedHere) return jsonRes(req, 403, { error: `Only the ${STAGE_LABEL[stage]} can ask for a clarification at this stage.` });
    if (!remark) return jsonRes(req, 400, { error: "Say what needs clarifying." });
    if (!(await move(stage, {
      status: "draft", return_to: stage,
      clarification_remark: remark, clarification_by: caller.id, clarification_at: stamp,
    }))) return raced();
    await logFinanceEvent(adminClient, { proposal_id: proposalId, scope: "pbg", action: "pbg_clarification_requested", remark, actor_id: caller.id });
    await clearPendingAlerts(adminClient, link, KIND_PBG);
    await notifyUsers(adminClient, team.filter((id) => id !== caller.id), {
      title: `Clarification requested by ${STAGE_LABEL[stage]} on the PBG Note`,
      sub_text: `${ref}: "${remark}" — once answered, forwarding it again sends it straight back to the ${STAGE_LABEL[stage]}.`,
      type: "action_required",
      link,
      kind: KIND_PBG,
    });
    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
