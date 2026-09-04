// supabase/functions/create-lead/index.ts
// JWT must be ON. Creates a lead (RFP or EOI; In-House, BA Source, or Suo
// Moto) directly into `pa_review` (the real intake form has one "Save Lead"
// action, no separate draft/submit step). Mirrors submit-ba-form's
// multipart handling for the optional RFP/Tender document upload, and
// advance-empanelment-stage's authorization-then-mutate-then-log shape for
// everything else.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";
import { notifyUser } from "../_shared/notify.ts";
import { logLeadActivity } from "../_shared/leadActivity.ts";
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

  const input = {
    title: get("title"),
    lead_type: get("lead_type") || "rfp",
    source: get("source") || "in_house",
    delivery_type: get("delivery_type") || null,
    person_responsible_id: get("person_responsible_id"),
    reviewer_id: get("reviewer_id"),
    approval_authority_id: get("approval_authority_id"),
  };

  const fieldErr = validateRequiredFields(input);
  if (fieldErr) return jsonRes(req, 400, { error: fieldErr });

  const assignedBaId = get("assigned_ba_id") || null;
  if (input.source === "ba" && !assignedBaId) {
    return jsonRes(req, 400, { error: "Select a Business Associate for a BA Source lead." });
  }
  // Name of BA is mandatory for a Suo Moto lead too, per product decision —
  // unlike In-House, where it's optional.
  if (input.source === "suo_moto" && !assignedBaId) {
    return jsonRes(req, 400, { error: "Select a Business Associate for a Suo Moto lead." });
  }

  try {
    // Team is derived from Person Responsible's own team — not a field the
    // creator picks directly, matching the real form (no Team selector).
    const { data: personResponsible, error: prErr } = await adminClient
      .from("afc_users")
      .select("id, team, is_active")
      .eq("id", input.person_responsible_id)
      .maybeSingle();
    if (prErr || !personResponsible || !personResponsible.is_active || !personResponsible.team) {
      return jsonRes(req, 400, { error: "Person Responsible is not a valid active user with a team." });
    }
    const team = personResponsible.team as string;

    // Every role can create a lead except MD and Admin, per explicit
    // product decision — Admin can view/manage everything but doesn't
    // originate leads. No separate creator-eligibility list; the caller's
    // existing afc_users.role (set on the Users page) is authoritative.
    if (caller.role === "md" || caller.role === "admin") {
      return jsonRes(req, 403, { error: `${caller.role === "md" ? "MD" : "Admin"} does not create leads directly.` });
    }

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
    let documents: Array<{ name: string; path: string; size: number; uploaded_at: string }> = [];
    let uploadedPath: string | null = null;
    const leadId = crypto.randomUUID();

    if (file instanceof File && file.size > 0) {
      const docErr = await validateDocument(file);
      if (docErr) return jsonRes(req, 400, { error: docErr });
      const uploaded = await uploadDocument(adminClient, leadId, file);
      documents = [uploaded];
      uploadedPath = uploaded.path;
    }

    const { data: leadNumberData, error: numErr } = await adminClient.rpc("next_lead_number", { p_team: team });
    if (numErr || !leadNumberData) {
      if (uploadedPath) await adminClient.storage.from(BUCKET).remove([uploadedPath]).catch(() => {});
      return jsonRes(req, 500, { error: "Failed to generate a lead number. Please try again." });
    }

    const { data: lead, error: insertErr } = await adminClient
      .from("leads")
      .insert({
        id: leadId,
        lead_number: leadNumberData,
        lead_type: input.lead_type,
        source: input.source,
        title: input.title.trim(),
        portal_name: clampText(get("portal_name"), 200),
        bid_number: clampText(get("bid_number"), 200),
        client_name: clampText(get("client_name"), 300),
        state: clampText(get("state"), 100),
        submission_deadline: get("submission_deadline") || null,
        delivery_type: input.delivery_type,
        // Suo-Moto-only dates ("Date of Presentation"/"Date of follow-up") —
        // null for every other lead type, same pattern as portal_name/
        // bid_number/state/delivery_type being irrelevant outside RFP/EOI.
        presentation_date: get("presentation_date") || null,
        followup_date: get("followup_date") || null,
        remark: clampText(get("remark")),
        documents,
        team,
        created_by: caller.id,
        person_responsible_id: input.person_responsible_id,
        reviewer_id: input.reviewer_id,
        approval_authority_id: input.approval_authority_id,
        assigned_ba_id: assignedBaId,
        status: "pa_review",
      })
      .select("id, lead_number, status")
      .single();

    if (insertErr || !lead) {
      if (uploadedPath) await adminClient.storage.from(BUCKET).remove([uploadedPath]).catch(() => {});
      console.error("Lead insert failed:", insertErr?.message);
      return jsonRes(req, 500, { error: "Failed to create lead. Please try again." });
    }

    await logLeadActivity(adminClient, lead.id, caller.id, caller.role, "created", null, "pa_review", null);

    if (input.person_responsible_id !== caller.id) {
      await notifyUser(adminClient, input.person_responsible_id, {
        title: "A lead has been assigned to you",
        sub_text: `${lead.lead_number} — "${input.title.trim()}" is awaiting your Accept/Drop decision.`,
        type: "action_required",
        link: `/leads/${lead.id}`,
      });
    }

    return jsonRes(req, 200, { success: true, id: lead.id, lead_number: lead.lead_number, status: lead.status });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
