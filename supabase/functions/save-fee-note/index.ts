// supabase/functions/save-fee-note/index.ts
// JWT must be ON. Creates or updates the one Bid Payment Requisition Note
// for a proposal — fee lines (EMD / Tender Fee / Processing Fee, each
// optional, each borne by AFC or the assigned Business Partner, each with
// its own payment mode and, for an instrument-based mode, its own payee
// details — one fee might go by Bank Guarantee while another goes by
// Demand Draft), the requisition addressee, client contact details, the
// implementation-arrangements narrative, and a justification.
//
// Keyed entirely by `proposal_id` (one note per proposal): it looks the
// note up, updates it if it exists and is still `draft`, creates it
// otherwise. No `fee_note_id` needed — the caller never has to know
// whether the note exists yet. Never needs a PIN (a PIN gates a
// signature, not a draft edit).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const PAYMENT_MODES = new Set(["online", "bank_guarantee", "demand_draft", "bankers_cheque", "fixed_deposit_receipt"]);
const FEE_KEYS = ["emd", "tender_fee", "processing_fee"] as const;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
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

  const proposalId = typeof body.proposal_id === "string" && body.proposal_id ? body.proposal_id : null;
  if (!proposalId) return jsonRes(req, 400, { error: "proposal_id is required." });

  const justification = str(body.justification);
  if (!justification) return jsonRes(req, 400, { error: "Justification is required." });

  // Fee lines — validate amount, borne-by, payment mode and (for an
  // instrument-based mode) payee details, one line at a time; require at
  // least one fee with an amount.
  const feeFields: Record<string, unknown> = {};
  let anyFee = false;
  for (const key of FEE_KEYS) {
    const amount = num(body[`${key}_amount`]);
    if (Number.isNaN(amount)) return jsonRes(req, 400, { error: `${key} amount must be a number.` });
    if (amount !== null && amount < 0) return jsonRes(req, 400, { error: `${key} amount can't be negative.` });
    const borneByRaw = body[`${key}_borne_by`];
    if (borneByRaw !== undefined && borneByRaw !== null && borneByRaw !== "afc" && borneByRaw !== "bp") {
      return jsonRes(req, 400, { error: `${key} borne-by must be "afc" or "bp".` });
    }
    const paymentModeRaw = body[`${key}_payment_mode`];
    if (paymentModeRaw !== null && paymentModeRaw !== undefined && paymentModeRaw !== "" && !PAYMENT_MODES.has(paymentModeRaw as string)) {
      return jsonRes(req, 400, { error: `${key} has an invalid payment mode.` });
    }
    if (amount !== null && amount > 0) anyFee = true;
    feeFields[`${key}_amount`] = amount;
    feeFields[`${key}_borne_by`] = borneByRaw === "bp" ? "bp" : "afc";
    feeFields[`${key}_payment_mode`] = str(paymentModeRaw);
    feeFields[`${key}_dd_in_favour_of`] = str(body[`${key}_dd_in_favour_of`]);
    feeFields[`${key}_dd_payable_at`] = str(body[`${key}_dd_payable_at`]);
  }
  if (!anyFee) return jsonRes(req, 400, { error: "Enter an amount for at least one of EMD, Tender Fee, or Processing Fee." });

  const anyBpBorne = FEE_KEYS.some((k) => feeFields[`${k}_borne_by`] === "bp");

  try {
    const { data: proposal, error: propErr } = await adminClient
      .from("proposal_preparations")
      .select("id, lead_id, locked")
      .eq("id", proposalId)
      .maybeSingle();
    if (propErr || !proposal) return jsonRes(req, 404, { error: "Proposal not found." });

    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, submission_deadline, person_responsible_id, reviewer_id, recommending_authority_id, assigned_ba_id")
      .eq("id", proposal.lead_id)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    const authorized =
      ["md", "admin"].includes(caller.role) ||
      [lead.person_responsible_id, lead.reviewer_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "Only the Person Responsible or Reviewer can edit this note." });

    const pastDeadline = !!lead.submission_deadline && new Date(lead.submission_deadline) < new Date();
    if (proposal.locked || pastDeadline) {
      return jsonRes(req, 400, { error: "This proposal is locked and can no longer be edited." });
    }

    if (anyBpBorne && !lead.assigned_ba_id) {
      return jsonRes(req, 400, { error: "This lead has no Business Partner, so a fee can't be borne by one." });
    }

    const { data: existing } = await adminClient
      .from("fee_notes")
      .select("id, status")
      .eq("proposal_id", proposalId)
      .maybeSingle();
    if (existing && existing.status !== "draft") {
      return jsonRes(req, 400, { error: `This note is "${existing.status}" and can't be edited right now.` });
    }

    const fields = {
      ...feeFields,
      submit_to: str(body.submit_to),
      client_address: str(body.client_address),
      client_telephone: str(body.client_telephone),
      client_email: str(body.client_email),
      implementation_arrangements: str(body.implementation_arrangements),
      justification,
    };

    let resultId = existing?.id ?? null;
    if (existing) {
      const { error: updErr } = await adminClient.from("fee_notes").update(fields).eq("id", existing.id);
      if (updErr) throw new Error(updErr.message);
    } else {
      const { data: created, error: insErr } = await adminClient
        .from("fee_notes")
        .insert({ proposal_id: proposalId, created_by: caller.id, ...fields })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      resultId = created.id;
    }

    return jsonRes(req, 200, { success: true, fee_note_id: resultId });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
