// supabase/functions/upload-user-signature/index.ts
// JWT must be ON. Admin-only: uploads/replaces the signature image used to
// sign a staff member's PDFs (currently the Lead Approval Note). Mirrors
// create-lead's uploadDocument/validateDocument pattern — magic-byte
// validation, sanitized filename, private bucket. One signature per user:
// any prior object is removed before the new one is stored, and
// afc_users.signature_path is overwritten rather than appended to.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, jsonRes } from "../_shared/cors.ts";
import { createAdminClient, getCallerProfile } from "../_shared/auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const BUCKET = "user-signatures";
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAGIC: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

async function validateSignatureImage(file: File): Promise<string> {
  const magic = MAGIC[file.type];
  if (!magic) return `"${file.name}" must be a PNG or JPEG image.`;
  if (file.size > MAX_FILE_SIZE) return `"${file.name}" exceeds the 2 MB limit.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  const bytes = new Uint8Array(await file.slice(0, magic.length).arrayBuffer());
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return `"${file.name}" does not appear to be a valid image.`;
  }
  return "";
}

export async function handleRequest(req: Request, adminClient: AdminClient = createAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const callerResult = await getCallerProfile(req, adminClient);
  if (!callerResult.ok) return jsonRes(req, callerResult.status, { error: callerResult.error });
  const caller = callerResult.caller;
  if (caller.role !== "admin") return jsonRes(req, 403, { error: "Only Admin can upload a user's signature." });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonRes(req, 400, { error: "Invalid form data." });
  }

  const userId = formData.get("user_id");
  if (typeof userId !== "string" || !userId) return jsonRes(req, 400, { error: "user_id is required." });

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return jsonRes(req, 400, { error: "A signature image is required." });

  const validationErr = await validateSignatureImage(file);
  if (validationErr) return jsonRes(req, 400, { error: validationErr });

  try {
    const { data: target, error: targetErr } = await adminClient
      .from("afc_users")
      .select("id, full_name, email, signature_path")
      .eq("id", userId)
      .maybeSingle();
    if (targetErr || !target) return jsonRes(req, 404, { error: "User not found." });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${userId}/${Date.now()}-${safeName}`;
    const body = new Uint8Array(await file.arrayBuffer());
    const { error: uploadErr } = await adminClient.storage.from(BUCKET).upload(path, body, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadErr) return jsonRes(req, 500, { error: "Failed to upload signature. Please try again." });

    if (target.signature_path) {
      await adminClient.storage.from(BUCKET).remove([target.signature_path]).catch(() => {});
    }

    const { error: updateErr } = await adminClient.from("afc_users").update({ signature_path: path }).eq("id", userId);
    if (updateErr) {
      await adminClient.storage.from(BUCKET).remove([path]).catch(() => {});
      return jsonRes(req, 500, { error: "Failed to save signature. Please try again." });
    }

    await adminClient.from("application_audit_log").insert({
      action_by: caller.id,
      action_by_role: caller.role,
      action: "user_signature_uploaded",
      comment: `Uploaded signature for ${target.full_name} (${target.email}).`,
    });

    return jsonRes(req, 200, { success: true });
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
