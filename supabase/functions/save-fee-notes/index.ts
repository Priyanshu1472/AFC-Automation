// supabase/functions/save-fee-notes/index.ts
// JWT must be ON. Person Responsible / Reviewer / Approval Authority (or
// md/admin) save 1-3 fee notes (EMD / Tender Fee / PBG) together — each
// note_type upserts its own row (unique proposal_id+note_type), so "3
// needed -> 3 rows, 1 needed -> 1 row" falls out of which types are passed.
// submit:true on an item moves it draft/rejected -> pending_md and
// notifies+emails the md role; submit:false just saves a draft. Blocked
// once the proposal is locked (manually or by the lead's deadline passing)
// — re-derived here in JS since the service-role client has no auth.uid()
// for can_edit_proposal() to evaluate.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { notifyRole, emailRole } from "../_shared/notify.ts";
import { wrapEmailBody, escapeHtml } from "../_shared/email.ts";

const NOTE_TYPES = new Set(["emd", "tender_fee", "pbg"]);
const NOTE_LABELS: Record<string, string> = { emd: "EMD Note", tender_fee: "Tender Fee Note", pbg: "PBG Note" };

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<Response> {
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

  const proposalId = body.proposal_id;
  const notes = body.notes;
  if (typeof proposalId !== "string" || !proposalId) return jsonRes(req, 400, { error: "proposal_id is required." });
  if (!Array.isArray(notes) || notes.length === 0) return jsonRes(req, 400, { error: "At least one fee note is required." });
  if (notes.length > 3) return jsonRes(req, 400, { error: "At most 3 fee notes (EMD, Tender Fee, PBG) can be saved at once." });

  const seenTypes = new Set<string>();
  for (const n of notes) {
    if (!n || typeof n !== "object") return jsonRes(req, 400, { error: "Invalid fee note entry." });
    const noteType = (n as Record<string, unknown>).note_type;
    if (typeof noteType !== "string" || !NOTE_TYPES.has(noteType)) return jsonRes(req, 400, { error: "Invalid note_type." });
    if (seenTypes.has(noteType)) return jsonRes(req, 400, { error: `Duplicate note_type: ${noteType}.` });
    seenTypes.add(noteType);
    const justification = (n as Record<string, unknown>).justification;
    if (typeof justification !== "string" || !justification.trim()) return jsonRes(req, 400, { error: `Justification is required for ${NOTE_LABELS[noteType]}.` });
    const amount = (n as Record<string, unknown>).amount;
    if (amount !== null && amount !== undefined && (typeof amount !== "number" || amount < 0)) {
      return jsonRes(req, 400, { error: `Amount for ${NOTE_LABELS[noteType]} must be a non-negative number.` });
    }
  }

  try {
    const { data: proposal, error: propErr } = await adminClient
      .from("proposal_preparations")
      .select("id, lead_id, locked")
      .eq("id", proposalId)
      .maybeSingle();
    if (propErr || !proposal) return jsonRes(req, 404, { error: "Proposal not found." });

    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, title, submission_deadline, person_responsible_id, reviewer_id, approval_authority_id")
      .eq("id", proposal.lead_id)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    const authorized =
      ["md", "admin"].includes(caller.role) ||
      [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id].includes(caller.id);
    if (!authorized) return jsonRes(req, 403, { error: "You do not have access to this proposal." });

    const pastDeadline = !!lead.submission_deadline && new Date(lead.submission_deadline) < new Date();
    if (proposal.locked || pastDeadline) {
      return jsonRes(req, 400, { error: "This proposal is locked and can no longer be edited." });
    }

    const { data: existingRows } = await adminClient
      .from("fee_notes")
      .select("id, note_type, status")
      .eq("proposal_id", proposalId)
      .in("note_type", [...seenTypes]);
    const existingByType: Record<string, { id: string; note_type: string; status: string }> =
      Object.fromEntries((existingRows || []).map((r: { id: string; note_type: string; status: string }) => [r.note_type, r]));

    for (const noteType of seenTypes) {
      const existing = existingByType[noteType];
      if (existing && ["pending_md", "approved"].includes(existing.status)) {
        return jsonRes(req, 400, { error: `${NOTE_LABELS[noteType]} is already ${existing.status === "pending_md" ? "awaiting MD approval" : "approved"} and cannot be edited.` });
      }
    }

    let anySubmitted = false;
    for (const n of notes) {
      const { note_type: noteType, amount, justification, submit } = n as { note_type: string; amount?: number | null; justification: string; submit?: boolean };
      const existing = existingByType[noteType];
      const wasRejected = existing?.status === "rejected";
      const nextStatus = submit ? "pending_md" : "draft";
      if (submit) anySubmitted = true;

      const row = {
        proposal_id: proposalId,
        note_type: noteType,
        amount: amount ?? null,
        justification: justification.trim(),
        status: nextStatus,
        md_decided_by: null,
        md_decided_at: null,
        md_remark: null,
        created_by: existing ? undefined : caller.id,
      };

      if (existing) {
        const { error: updErr } = await adminClient.from("fee_notes").update(row).eq("id", existing.id);
        if (updErr) throw new Error(updErr.message);
        if (submit) {
          await adminClient.from("fee_note_events").insert({
            fee_note_id: existing.id, actor_id: caller.id, actor_name: caller.email,
            action: wasRejected ? "resubmitted" : "submitted", remark: null,
          });
        }
      } else {
        const { data: created, error: insErr } = await adminClient.from("fee_notes").insert(row).select("id").single();
        if (insErr) throw new Error(insErr.message);
        if (submit) {
          await adminClient.from("fee_note_events").insert({
            fee_note_id: created.id, actor_id: caller.id, actor_name: caller.email, action: "submitted", remark: null,
          });
        }
      }
    }

    if (anySubmitted) {
      const submittedCount = notes.filter((n: any) => n.submit).length;
      const submittedLabels = notes.filter((n: any) => n.submit).map((n: any) => NOTE_LABELS[n.note_type]).join(", ");
      const payload = {
        title: "Fee note(s) awaiting your approval",
        sub_text: `${submittedLabels} for "${lead.title}" need your approval.`,
        type: "action_required",
        link: "/leads",
      };
      await notifyRole(adminClient, "md", payload);
      await emailRole(adminClient, "md", {
        subject: "Fee Note Awaiting Your Approval — AFC India Limited",
        html: wrapEmailBody(`
          <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.7;">
            ${escapeHtml(submittedLabels)} for <strong>${escapeHtml(lead.title)}</strong> ${submittedCount > 1 ? "have" : "has"} been submitted for your approval.
          </p>
        `),
      });
    }

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: (err as Error).message || "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
