// supabase/functions/_shared/otp.ts
// One-time codes gating MD's accept/reject decision and the DGM's
// provisional-letter send. A code is generated, hashed, stored, and emailed
// to the ACTOR'S OWN registered address (never anywhere else) — verification
// happens inside the same request that performs the real action, so nothing
// mutates and no decision email goes out until the code is confirmed. See
// supabase/migrations/20260721010000_empanelment_action_otps.sql.

import { createAdminClient } from "./auth.ts";
import { checkRateLimit } from "./publicAccess.ts";
import { sendResendEmail, wrapEmailBody, escapeHtml } from "./email.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const OTP_TTL_MINUTES = 10;

const ACTION_LABELS: Record<string, string> = {
  md_accept: "accept this empanelment application",
  md_reject: "reject this empanelment application",
  provisional_letter: "send the provisional empanelment letter",
};

function generateOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

async function hashOtp(otp: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(otp));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueOtp(
  admin: AdminClient,
  opts: { userId: string; userEmail: string; applicationId: string; action: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rate = await checkRateLimit(admin, `otp_req:${opts.userId}:${opts.applicationId}:${opts.action}`, 3, 10 * 60);
  if (!rate.allowed) return { ok: false, error: `Too many code requests. Try again in about ${rate.waitMinutes} minute(s).` };

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  // Invalidate any earlier unconsumed codes for this exact action so only
  // the most recently emailed code can ever verify.
  await admin
    .from("empanelment_action_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", opts.userId)
    .eq("application_id", opts.applicationId)
    .eq("action", opts.action)
    .is("consumed_at", null);

  const { error: insertErr } = await admin.from("empanelment_action_otps").insert({
    user_id: opts.userId,
    application_id: opts.applicationId,
    action: opts.action,
    otp_hash: otpHash,
    expires_at: expiresAt,
  });
  if (insertErr) {
    console.error("issueOtp insert failed:", insertErr.message);
    return { ok: false, error: "Could not generate a verification code. Please try again." };
  }

  const html = wrapEmailBody(`
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear ${escapeHtml(opts.userEmail)},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
      Use the code below to confirm you want to ${ACTION_LABELS[opts.action] || "complete this action"}. This code expires in ${OTP_TTL_MINUTES} minutes and can only be used once.
    </p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px 24px;margin:0 0 20px;text-align:center;">
      <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:0.2em;color:#1e40af;font-family:monospace;">${otp}</p>
    </div>
    <p style="margin:0;font-size:12px;color:#6b7280;">If you did not request this, you can safely ignore this email — no action will be taken without the code above.</p>
  `);
  const sent = await sendResendEmail({ to: opts.userEmail, subject: "Your AFC India Limited verification code", html });
  if (!sent) return { ok: false, error: "Could not send the verification code email. Please try again." };

  return { ok: true };
}

export async function verifyOtp(
  admin: AdminClient,
  opts: { userId: string; applicationId: string; action: string; otp: unknown }
): Promise<boolean> {
  const rate = await checkRateLimit(admin, `otp_verify:${opts.userId}:${opts.applicationId}:${opts.action}`, 5, 15 * 60);
  if (!rate.allowed) return false;

  if (typeof opts.otp !== "string" || !/^\d{6}$/.test(opts.otp)) return false;

  const { data: row } = await admin
    .from("empanelment_action_otps")
    .select("id, otp_hash, expires_at")
    .eq("user_id", opts.userId)
    .eq("application_id", opts.applicationId)
    .eq("action", opts.action)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;

  const candidateHash = await hashOtp(opts.otp);
  if (candidateHash !== row.otp_hash) return false;

  await admin.from("empanelment_action_otps").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
  return true;
}
