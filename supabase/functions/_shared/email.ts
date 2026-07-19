// supabase/functions/_shared/email.ts
// Shared Resend sender + HTML-escaping, generalized from
// create-staff-user's sendCredentialsEmail.

export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Shared header/footer chrome so every AFC email looks consistent; callers
// supply just the body HTML.
export function wrapEmailBody(bodyHtml: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>AFC India Limited</title></head>
    <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
        <tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;max-width:600px;width:100%;">
            <tr><td style="padding:24px 32px;background:#1a5fd4;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">AFC India Limited</p>
              <p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,0.75);">Agricultural Finance Corporation &middot; Serving India since 1968</p>
            </td></tr>
            <tr><td style="padding:32px;">
              ${bodyHtml}
            </td></tr>
            <tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;background:#f9fafb;border-radius:0 0 12px 12px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">This is an automated email from AFC India Limited. Please do not reply.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;
}

export async function sendResendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured");
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "AFC India Limited <noreply@pmis.afcindia.org.in>",
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    console.error("Resend API error:", await res.text());
    return false;
  }
  return true;
}
