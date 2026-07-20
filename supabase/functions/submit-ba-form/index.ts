// supabase/functions/submit-ba-form/index.ts
// JWT verification must be OFF for this function (public, BA-facing).
// Security: anon key check + rate limiting + server-side field validation +
// PDF magic-byte file validation. Uploads go to the private `ba-documents`
// bucket — only the storage path is stored, never a public URL (see
// get-empanelment-document-url for how reviewers view a doc).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { checkAnonKey, getClientIP, checkRateLimit, clearRateLimit } from "../_shared/publicAccess.ts";
import { notifyUser } from "../_shared/notify.ts";


function clean(val: unknown): string {
  if (val === null || val === undefined) return "";
  // eslint-disable-next-line no-control-regex
  return String(val).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

function safeJSON(val: unknown): unknown {
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  return val;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = "application/pdf";
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

async function validateFileBytes(file: File): Promise<string> {
  if (file.type !== ALLOWED_MIME) return `"${file.name}" is not a PDF file.`;
  if (file.size > MAX_FILE_SIZE) return `"${file.name}" exceeds the 10 MB limit.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) return `"${file.name}" does not appear to be a valid PDF.`;
  }
  return "";
}

const BUCKET = "ba-documents";

async function uploadFile(adminClient: ReturnType<typeof createClient>, filePath: string, file: File) {
  const fileBody = new Uint8Array(await file.arrayBuffer());
  const { error } = await adminClient.storage.from(BUCKET).upload(filePath, fileBody, {
    contentType: ALLOWED_MIME,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed for "${file.name}": ${error.message}`);
}

// Must match DOC_SLOTS in src/pages/empanelment/BaFormPage.jsx.
const DOC_SLOT_CONFIG: Record<string, { multiple: boolean }> = {
  panCopy: { multiple: false },
  incorporationCert: { multiple: false },
  gstCert: { multiple: false },
  nonBlacklisting: { multiple: false },
  mcaCompliance: { multiple: false },
  financials: { multiple: true },
  netWorthCert: { multiple: false },
  isoCert: { multiple: false },
  cancelledCheque: { multiple: false },
  workOrders: { multiple: false },
};

// Explicit form-field -> column mapping (not a derived camelCase->snake_case
// conversion — that broke on consecutive capitals like "lastBSFiled").
const TEXT_FIELD_COLUMNS: Record<string, string> = {
  entityTypeOther: "entity_type_other",
  cin: "cin",
  regAddress: "reg_address",
  branchAddress: "branch_address",
  website: "website",
  lastBSFiled: "last_bs_filed",
  directorKyc: "director_kyc",
  workingCapitalRatio: "working_capital_ratio",
  caFirmName: "ca_firm_name",
  caRegNo: "ca_reg_no",
  otherSectors: "other_sectors",
  certifications: "certifications",
  govtEmpanelments: "govt_empanelments",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  if (!checkAnonKey(req)) return jsonRes(req, 401, { error: "Unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, supabaseService);

  const clientIP = getClientIP(req);
  const rateResult = await checkRateLimit(adminClient, `ba-form:${clientIP}`);
  if (!rateResult.allowed) {
    return jsonRes(req, 429, {
      error: `Too many attempts. Please wait ${rateResult.waitMinutes} minute${rateResult.waitMinutes > 1 ? "s" : ""} before trying again.`,
    });
  }

  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return jsonRes(req, 400, { error: "Invalid form data. Please try again." });
    }

    const appCode = clean(formData.get("app_code"));
    if (!appCode || !/^\d{5}$/.test(appCode)) {
      return jsonRes(req, 400, { error: "Application code must be exactly 5 digits." });
    }

    const { data: application, error: appErr } = await adminClient
      .from("empanelment_applications")
      .select("id, status, project_officer_id")
      .eq("application_code", appCode)
      .maybeSingle();
    if (appErr) throw new Error("Database error. Please try again.");
    if (!application) return jsonRes(req, 400, { error: "Invalid application code. Please check and try again." });

    if (application.status !== "sent") {
      return jsonRes(req, 400, {
        error:
          application.status === "po_review"
            ? "This application code has already been used. Each code can only be submitted once."
            : `This application is in "${application.status}" status and cannot be submitted.`,
      });
    }

    const get = (key: string) => clean(formData.get(key));
    const email = get("email");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonRes(req, 400, { error: "Invalid email address." });
    }

    const pan = get("pan").toUpperCase();
    if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      return jsonRes(req, 400, { error: "Invalid PAN number." });
    }

    const ifsc = get("ifscCode").toUpperCase();
    if (!ifsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      return jsonRes(req, 400, { error: "Invalid IFSC code." });
    }

    const accountNumber = get("accountNumber");
    if (!accountNumber || !/^\d{9,18}$/.test(accountNumber)) {
      return jsonRes(req, 400, { error: "Invalid bank account number." });
    }

    const gst = get("gst").toUpperCase();
    if (gst && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst)) {
      return jsonRes(req, 400, { error: "Invalid GST number." });
    }

    const yearEstablished = parseInt(get("yearEstablished"), 10);
    const currentYear = new Date().getFullYear();
    if (isNaN(yearEstablished) || yearEstablished < 1800 || yearEstablished > currentYear) {
      return jsonRes(req, 400, { error: `Year of establishment must be between 1800 and ${currentYear}.` });
    }

    if (get("declared") !== "true") {
      return jsonRes(req, 400, { error: "Declaration must be accepted to submit." });
    }

    const collectedFiles: Record<string, File[]> = {};
    const fileValidationErrors: string[] = [];

    for (const [slotKey, cfg] of Object.entries(DOC_SLOT_CONFIG)) {
      if (cfg.multiple) {
        const arr: File[] = [];
        let idx = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const entry = formData.get(`${slotKey}_${idx}`);
          if (!entry || !(entry instanceof File) || entry.size === 0) break;
          arr.push(entry);
          idx++;
        }
        collectedFiles[slotKey] = arr;
      } else {
        const entry = formData.get(slotKey);
        collectedFiles[slotKey] = entry instanceof File && entry.size > 0 ? [entry] : [];
      }
    }

    for (const [slotKey, fileArr] of Object.entries(collectedFiles)) {
      for (const file of fileArr) {
        const err = await validateFileBytes(file);
        if (err) fileValidationErrors.push(`[${slotKey}] ${err}`);
      }
    }
    if (fileValidationErrors.length > 0) {
      return jsonRes(req, 400, { error: fileValidationErrors.join(" | ") });
    }

    const timestamp = Date.now();
    const uploadedDocs: Array<{ slot: string; name: string; path: string; size: number; uploaded_at: string }> = [];

    for (const [slotKey, fileArr] of Object.entries(collectedFiles)) {
      for (const file of fileArr) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = `${application.id}/${slotKey}/${timestamp}-${safeName}`;
        await uploadFile(adminClient, filePath, file);
        uploadedDocs.push({ slot: slotKey, name: file.name, path: filePath, size: file.size, uploaded_at: new Date().toISOString() });
      }
    }

    const registrationData: Record<string, unknown> = { application_id: application.id };
    Object.entries(TEXT_FIELD_COLUMNS).forEach(([formKey, column]) => {
      registrationData[column] = get(formKey) || null;
    });
    Object.assign(registrationData, {
      org_name: get("orgName"),
      entity_type: get("entityType"),
      year_established: yearEstablished,
      contact_person: get("contactPerson"),
      designation: get("designation"),
      phone: get("phone"),
      email,
      pan,
      gst: gst || null,
      msme_no: get("msmeNo") || null,
      companies_act_status: get("companiesActStatus"),
      company_status: get("companyStatus"),
      date_of_incorporation: get("dateOfIncorporation") || null,
      authorised_capital: parseFloat(get("authorisedCapital")) || null,
      paidup_capital: parseFloat(get("paidupCapital")) || null,
      net_worth: safeJSON(formData.get("netWorth")),
      turnover: safeJSON(formData.get("turnover")),
      pat: safeJSON(formData.get("pat")),
      cash_flow: safeJSON(formData.get("cashFlow")),
      core_expertise: get("coreExpertise"),
      sectors_served: safeJSON(formData.get("sectors")),
      team_size: parseInt(get("teamSize"), 10) || null,
      years_experience: parseInt(get("yearsExperience"), 10) || null,
      assignments: safeJSON(formData.get("assignments")),
      bank_name: get("bankName"),
      bank_branch: get("bankBranch"),
      account_number: accountNumber,
      ifsc_code: ifsc,
      declaration_accepted: true,
      documents: uploadedDocs,
    });

    const { error: regErr } = await adminClient.from("ba_registrations").insert([registrationData]);
    if (regErr) {
      for (const doc of uploadedDocs) {
        await adminClient.storage.from(BUCKET).remove([doc.path]).catch(() => {});
      }
      console.error("Registration insert error:", regErr.message);
      throw new Error("Failed to save registration. Please try again.");
    }

    // No actor sits between "BA submitted" and "PO reviews" — go straight to
    // po_review, the status the PO's queue actually filters on.
    await adminClient
      .from("empanelment_applications")
      .update({ status: "po_review", form_submitted_at: new Date().toISOString() })
      .eq("id", application.id);

    await adminClient.from("empanelment_activity_log").insert({
      application_id: application.id,
      actor_id: null,
      actor_role: "ba",
      action: "ba_filled",
      comment: `BA form submitted by ${get("orgName")} (${email}). Documents uploaded: ${uploadedDocs.length}.`,
    });

    await notifyUser(adminClient, application.project_officer_id, {
      title: "New empanelment form submitted",
      sub_text: `${get("orgName")} has submitted their empanelment application. Please review.`,
      type: "action_required",
      link: `/empanelment/${application.id}`,
    });

    clearRateLimit(adminClient, `ba-form:${clientIP}`);

    return jsonRes(req, 200, { success: true, documents_count: uploadedDocs.length });
  } catch (err) {
    console.error("Unhandled error:", err);
    return jsonRes(req, 500, { error: err instanceof Error ? err.message : "Internal server error. Please try again." });
  }
});
