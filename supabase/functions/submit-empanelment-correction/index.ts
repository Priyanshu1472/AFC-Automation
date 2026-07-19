// supabase/functions/submit-empanelment-correction/index.ts
// JWT verification must be OFF for this function (public, BA-facing).
// Security: anon key check + rate limiting. Only fields with an OPEN
// compliance_flags row for this application may be corrected — enforced
// server-side, not just hidden in the UI. Resumes review at whichever stage
// raised the hold (hold_origin_status), so a hold raised after CFO/CS already
// reviewed doesn't force a redundant second CFO/CS pass. Falls back to
// po_review for older rows without a stored origin.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { checkAnonKey, getClientIP, checkRateLimit, clearRateLimit } from "../_shared/publicAccess.ts";

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const BUCKET = "ba-documents";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function clean(val: unknown): string {
  if (val === null || val === undefined) return "";
  // eslint-disable-next-line no-control-regex
  return String(val).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

// Format validators for fields with a strict shape — same rules as
// submit-ba-form, keyed by the ba_registrations column name.
const FIELD_VALIDATORS: Record<string, (v: string) => string> = {
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Enter a valid email address."),
  pan: (v) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase()) ? "" : "PAN format: ABCDE1234F."),
  gst: (v) => (v === "" || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v.toUpperCase()) ? "" : "Enter a valid 15-character GST number."),
  ifsc_code: (v) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase()) ? "" : "IFSC format: 4 letters + 0 + 6 alphanumeric."),
  account_number: (v) => (/^\d{9,18}$/.test(v) ? "" : "Account number must be 9–18 digits."),
  phone: (v) => (/^\d{10}$/.test(v) ? "" : "Enter a valid 10-digit phone number."),
};

async function validateFileBytes(file: File): Promise<string> {
  if (file.type !== "application/pdf") return `"${file.name}" is not a PDF file.`;
  if (file.size > MAX_FILE_SIZE) return `"${file.name}" exceeds the 10 MB limit.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  for (let i = 0; i < PDF_MAGIC.length; i++) if (bytes[i] !== PDF_MAGIC[i]) return `"${file.name}" does not appear to be a valid PDF.`;
  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });
  if (!checkAnonKey(req)) return jsonRes(req, 401, { error: "Unauthorized" });

  const clientIP = getClientIP(req);
  const rateResult = checkRateLimit(rateLimitStore, clientIP);
  if (!rateResult.allowed) return jsonRes(req, 429, { error: `Too many attempts. Please wait ${rateResult.waitMinutes} minute(s) before trying again.` });

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return jsonRes(req, 400, { error: "Invalid form data. Please try again." });
    }

    const appCode = clean(formData.get("app_code"));
    if (!appCode || !/^\d{5}$/.test(appCode)) return jsonRes(req, 400, { error: "Application code must be exactly 5 digits." });

    const { data: application, error: appErr } = await adminClient
      .from("empanelment_applications")
      .select("id, status, hold_origin_status")
      .eq("application_code", appCode)
      .maybeSingle();
    if (appErr) throw new Error("Database error. Please try again.");
    if (!application) return jsonRes(req, 400, { error: "Invalid application code. Please check and try again." });
    if (application.status !== "on_hold") return jsonRes(req, 400, { error: `This application is in "${application.status}" status — there is nothing pending correction.` });

    const { data: openFlags, error: flagsErr } = await adminClient
      .from("compliance_flags")
      .select("id, field_key")
      .eq("application_id", application.id)
      .eq("status", "open");
    if (flagsErr) throw new Error("Database error. Please try again.");
    const openFieldKeys = new Set((openFlags || []).map((f) => f.field_key));
    if (openFieldKeys.size === 0) return jsonRes(req, 400, { error: "There are no open items to correct on this application." });

    let submittedKeys: string[];
    try {
      submittedKeys = JSON.parse(clean(formData.get("field_keys")) || "[]");
    } catch {
      return jsonRes(req, 400, { error: "Invalid field list." });
    }
    if (!Array.isArray(submittedKeys) || submittedKeys.length === 0) return jsonRes(req, 400, { error: "No corrections were submitted." });

    for (const key of submittedKeys) {
      if (!openFieldKeys.has(key)) return jsonRes(req, 400, { error: `"${key}" is not currently flagged for correction on this application.` });
    }

    const { data: reg, error: regErr } = await adminClient.from("ba_registrations").select("*").eq("application_id", application.id).maybeSingle();
    if (regErr || !reg) throw new Error("Registration data not found.");

    const columnUpdates: Record<string, unknown> = {};
    const resolvedFlagUpdates: Array<{ id: string; old_value: string | null; new_value: string }> = [];
    let documents: Array<{ slot: string; name: string; path: string; size: number; uploaded_at: string }> = Array.isArray(reg.documents) ? reg.documents : [];
    const pathsToRemove: string[] = [];
    const uploadedPaths: string[] = [];

    for (const key of submittedKeys) {
      const flagRow = (openFlags || []).find((f) => f.field_key === key)!;

      if (key.startsWith("doc:")) {
        const slot = key.slice(4);
        const file = formData.get(key);
        if (!(file instanceof File) || file.size === 0) return jsonRes(req, 400, { error: `A replacement file is required for "${slot}".` });
        const fileErr = await validateFileBytes(file);
        if (fileErr) return jsonRes(req, 400, { error: fileErr });

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = `${application.id}/${slot}/${Date.now()}-${safeName}`;
        const fileBody = new Uint8Array(await file.arrayBuffer());
        const { error: uploadErr } = await adminClient.storage.from(BUCKET).upload(filePath, fileBody, { contentType: "application/pdf", cacheControl: "3600", upsert: false });
        if (uploadErr) throw new Error(`Upload failed for "${file.name}": ${uploadErr.message}`);
        uploadedPaths.push(filePath);

        const oldDocs = documents.filter((d) => d.slot === slot);
        pathsToRemove.push(...oldDocs.map((d) => d.path));
        documents = documents.filter((d) => d.slot !== slot);
        documents.push({ slot, name: file.name, path: filePath, size: file.size, uploaded_at: new Date().toISOString() });

        resolvedFlagUpdates.push({ id: flagRow.id, old_value: oldDocs[0]?.name || null, new_value: file.name });
      } else {
        const rawValue = clean(formData.get(key));
        if (!rawValue) return jsonRes(req, 400, { error: `A value is required for "${key}".` });
        const normalized = ["pan", "ifsc_code", "gst", "cin", "msme_no", "ca_reg_no"].includes(key) ? rawValue.toUpperCase() : rawValue;
        const validator = FIELD_VALIDATORS[key];
        if (validator) {
          const err = validator(normalized);
          if (err) return jsonRes(req, 400, { error: err });
        }
        resolvedFlagUpdates.push({ id: flagRow.id, old_value: reg[key] !== undefined && reg[key] !== null ? String(reg[key]) : null, new_value: normalized });
        columnUpdates[key] = normalized;
      }
    }

    columnUpdates.documents = documents;

    const { error: updateErr } = await adminClient.from("ba_registrations").update(columnUpdates).eq("application_id", application.id);
    if (updateErr) {
      for (const p of uploadedPaths) await adminClient.storage.from(BUCKET).remove([p]).catch(() => {});
      throw new Error("Failed to save corrections. Please try again.");
    }

    for (const p of pathsToRemove) await adminClient.storage.from(BUCKET).remove([p]).catch(() => {});

    for (const u of resolvedFlagUpdates) {
      await adminClient.from("compliance_flags").update({ status: "resolved", old_value: u.old_value, new_value: u.new_value, resolved_at: new Date().toISOString() }).eq("id", u.id);
    }

    // Resume at the stage that raised the hold — falls back to po_review if
    // this application predates hold_origin_status being tracked.
    const VALID_RESUME_STATUSES = new Set(["po_review", "po_final_review", "dgm_review", "md_review"]);
    const resumeStatus = VALID_RESUME_STATUSES.has(application.hold_origin_status || "") ? application.hold_origin_status : "po_review";
    await adminClient.from("empanelment_applications").update({ status: resumeStatus, hold_origin_status: null }).eq("id", application.id);

    await adminClient.from("empanelment_activity_log").insert({
      application_id: application.id,
      actor_id: null,
      actor_role: "ba",
      action: "ba_corrected",
      comment: `Corrected: ${submittedKeys.join(", ")}.`,
    });

    clearRateLimit(rateLimitStore, clientIP);
    return jsonRes(req, 200, { success: true, corrected_count: submittedKeys.length });
  } catch (err) {
    console.error("Unhandled error:", err);
    return jsonRes(req, 500, { error: err instanceof Error ? err.message : "Internal server error. Please try again." });
  }
});
