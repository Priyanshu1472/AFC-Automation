// supabase/functions/update-lead/index.ts
// JWT must be ON. Edit is available to the creator/Person Responsible at
// two points: while a lead is still at `pa_review` (before the PR has
// accepted it — a plain in-place edit, status unchanged), and once it's
// `pa_action_required` (returned by PMT / PMT Extended / DGM with a note —
// an Edit & Resubmit that moves it back into `pmt_review`, logging both
// `edited` and `resubmitted` so the prior version's existence stays visible
// in the timeline without a separate versioning table). Every other status
// (accepted and under active review, or terminal) is locked.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { notifyUsers } from "../_shared/notify.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
import { getOrgWideHolders } from "../_shared/leadAuth.ts";
import {
  validateRequiredFields, validateAssignment, validateReviewer,
  validateApprovalAuthority, validateBusinessAssociate, clampText,
} from "../_shared/leadEligibility.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const BUCKET = "lead-documents";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAGIC: Record<string, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
  "application/msword": [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [0x50, 0x4b, 0x03, 0x04],
};

function clean(val: FormDataEntryValue | null): string {
  if (val === null || typeof val !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

async function validateDocument(file: File): Promise<string> {
  const magic = MAGIC[file.type];
  if (!magic) return `"${file.name}" must be a PDF or Word document.`;
  if (file.size > MAX_FILE_SIZE) return `"${file.name}" exceeds the 10 MB limit.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  const bytes = new Uint8Array(await file.slice(0, magic.length).arrayBuffer());
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return `"${file.name}" does not appear to be a valid document.`;
  }
  return "";
}

async function uploadDocument(admin: AdminClient, leadId: string, file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${leadId}/${Date.now()}-${safeName}`;
  const body = new Uint8Array(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, body, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed for "${file.name}": ${error.message}`);
  return { name: file.name, path, size: file.size, uploaded_at: new Date().toISOString() };
}

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonRes(req, 400, { error: "Invalid form data." });
  }

  const get = (key: string) => clean(formData.get(key));
  const leadId = get("lead_id");
  if (!leadId) return jsonRes(req, 400, { error: "lead_id is required." });

  const input = {
    delivery_type: get("delivery_type") || null,
    person_responsible_id: get("person_responsible_id"),
    reviewer_id: get("reviewer_id"),
    approval_authority_id: get("approval_authority_id"),
  };

  const assignedBaId = get("assigned_ba_id") || null;

  try {
    // title/portal_name/bid_number are locked once a lead exists — the UI
    // disables them, and this is the server-side backstop: whatever the
    // client sent for those three is ignored, the lead's existing values
    // are always what gets written back.
    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("id, status, created_by, person_responsible_id, lead_number, documents, title, portal_name, bid_number, declined_from_status")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !lead) return jsonRes(req, 404, { error: "Lead not found." });

    const fieldErr = validateRequiredFields({ ...input, title: lead.title });
    if (fieldErr) return jsonRes(req, 400, { error: fieldErr });

    if (caller.id !== lead.created_by && caller.id !== lead.person_responsible_id) {
      return jsonRes(req, 403, { error: "Only the lead's creator or Person Responsible can edit it." });
    }
    if (lead.status !== "pa_action_required" && lead.status !== "pa_review") {
      return jsonRes(req, 400, {
        error: `This lead is in "${lead.status}" status and cannot be edited right now. It may have just been updated — refresh and try again.`,
      });
    }
    const fromStatus = lead.status as string;
    const isResubmit = fromStatus === "pa_action_required";
    // Resubmitting routes back to wherever declined it: DGM (first-line
    // gate) sends it straight back to DGM; MD sends it straight back to MD
    // (skipping every committee — MD already saw and cleared it once);
    // every other decline source (PMT/PMT Extended/G3) funnels back into
    // pmt_review, same as before.
    const toStatus = isResubmit
      ? (lead.declined_from_status === "dgm_initial_review" ? "dgm_initial_review"
        : lead.declined_from_status === "md_review" ? "md_review"
        : "pmt_review")
      : "pa_review";
    // Required only when resubmitting straight back to the MD — explains
    // what changed since the MD's decline. Deliberately logged onto the
    // "resubmitted" activity row only, never onto the lead itself, so it
    // can't get pulled into the Lead/MD Approval Note PDF (that only reads
    // specific committee/MD decision actions, never "resubmitted").
    const resubmitComment = clampText(get("resubmit_comment"), 2000);
    if (isResubmit && toStatus === "md_review" && !resubmitComment) {
      return jsonRes(req, 400, { error: "Add a remark explaining the changes before resubmitting to the MD." });
    }

    const { data: personResponsible, error: prErr } = await adminClient
      .from("afc_users")
      .select("id, team, is_active")
      .eq("id", input.person_responsible_id)
      .maybeSingle();
    if (prErr || !personResponsible || !personResponsible.is_active || !personResponsible.team) {
      return jsonRes(req, 400, { error: "Person Responsible is not a valid active user with a team." });
    }
    const team = personResponsible.team as string;

    const assignErr = await validateAssignment(adminClient, input.person_responsible_id, team);
    if (assignErr) return jsonRes(req, 400, { error: assignErr });

    const reviewerErr = await validateReviewer(adminClient, input.reviewer_id, team);
    if (reviewerErr) return jsonRes(req, 400, { error: reviewerErr });

    const authorityErr = await validateApprovalAuthority(adminClient, input.approval_authority_id, team);
    if (authorityErr) return jsonRes(req, 400, { error: authorityErr });

    if (assignedBaId) {
      const baErr = await validateBusinessAssociate(adminClient, assignedBaId, team);
      if (baErr) return jsonRes(req, 400, { error: baErr });
    }

    const file = formData.get("document");
    let documents = (lead.documents as Array<{ name: string; path: string; size: number; uploaded_at: string }>) || [];
    let uploadedPath: string | null = null;

    if (file instanceof File && file.size > 0) {
      const docErr = await validateDocument(file);
      if (docErr) return jsonRes(req, 400, { error: docErr });
      const uploaded = await uploadDocument(adminClient, lead.id, file);
      documents = [...documents, uploaded];
      uploadedPath = uploaded.path;
    }

    const { error: updateErr } = await adminClient
      .from("leads")
      .update({
        // title/portal_name/bid_number deliberately NOT taken from the
        // client — see the comment above the initial select.
        client_name: clampText(get("client_name"), 300),
        state: clampText(get("state"), 100),
        submission_deadline: get("submission_deadline") || null,
        delivery_type: input.delivery_type,
        presentation_date: get("presentation_date") || null,
        followup_date: get("followup_date") || null,
        remark: clampText(get("remark")),
        documents,
        team,
        person_responsible_id: input.person_responsible_id,
        reviewer_id: input.reviewer_id,
        approval_authority_id: input.approval_authority_id,
        assigned_ba_id: assignedBaId,
        status: toStatus,
        ...(isResubmit ? { submitted_at: new Date().toISOString() } : {}),
      })
      .eq("id", lead.id)
      .eq("status", fromStatus);

    if (updateErr) {
      if (uploadedPath) await adminClient.storage.from(BUCKET).remove([uploadedPath]).catch(() => {});
      console.error("Lead update failed:", updateErr.message);
      return jsonRes(req, 500, { error: "Failed to update lead. Please try again." });
    }

    await logLeadActivity(adminClient, lead.id, caller.id, caller.role, "edited", fromStatus, fromStatus, null);
    if (isResubmit) {
      await logLeadActivity(adminClient, lead.id, caller.id, caller.role, "resubmitted", "pa_action_required", toStatus, resubmitComment || null);
    }

    const resubmitTargetHolders = isResubmit
      ? toStatus === "md_review"
        ? await getOrgWideHolders(adminClient, { role: "md" })
        : await getOrgWideHolders(adminClient, toStatus === "dgm_initial_review" ? { committee: "G3" } : { committee: "PMT" })
      : [];
    if (resubmitTargetHolders.length) {
      await notifyUsers(adminClient, resubmitTargetHolders, {
        title: toStatus === "dgm_initial_review" ? "Lead resubmitted — awaiting DGM review"
          : toStatus === "md_review" ? "Lead resubmitted — awaiting MD approval"
          : "Lead resubmitted — awaiting PMT review",
        sub_text: `${lead.lead_number} — "${lead.title}" was edited and resubmitted for review.`,
        type: "action_required",
        link: `/leads/${lead.id}`,
      });
    }

    return jsonRes(req, 200, { success: true, id: lead.id, lead_number: lead.lead_number, status: toStatus });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
