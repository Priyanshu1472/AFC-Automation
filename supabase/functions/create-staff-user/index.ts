// supabase/functions/create-staff-user/index.ts
// JWT must be ON. Server-side role verification — never trusts client-sent role.
// Creates a Supabase Auth account + afc_users profile row, generates a
// random temporary password, and emails it via Resend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { DEFAULT_PIN, hashPin } from "../_shared/pin.ts";

// Deploy-preview / branch-deploy subdomains are generated per-PR by
// Netlify and can't be enumerated in advance, so we match by suffix
// instead of an exact list. Set via `supabase secrets set
// NETLIFY_SITE_SUFFIX=--your-site-name.netlify.app` once the Netlify site
// exists. Until then, only localhost + ALLOWED_ORIGIN are permitted
// (fail closed, not open).
const STATIC_ALLOWED_ORIGINS = ["http://localhost:5173"];
const NETLIFY_SITE_SUFFIX = Deno.env.get("NETLIFY_SITE_SUFFIX") || "";
const EXTRA_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "";

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.includes(origin)) return true;
  if (EXTRA_ORIGIN && origin === EXTRA_ORIGIN) return true;
  if (NETLIFY_SITE_SUFFIX) {
    try {
      return new URL(origin).hostname.endsWith(NETLIFY_SITE_SUFFIX);
    } catch {
      return false;
    }
  }
  return false;
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = isAllowedOrigin(origin) ? origin : STATIC_ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonRes(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

// User creation is Admin-only — MD's earlier bootstrap allowance to create
// the first Admin account is retired now that Users management is
// Admin-only everywhere (an Admin account already exists in every real
// environment; recovering from zero Admins is an out-of-band ops task, not
// a normal-flow UI capability).
const ADMIN_CREATABLE_ROLES = ["cfo", "cs", "dgm", "agm", "srm", "project_officer", "associate_consultant", "project_assistant"];

// Lead Generation review committees — an optional, independent tag on top
// of the person's HR role (e.g. a DGM sits on G3; a Project Officer might
// sit on PMT). Not every role needs one.
const LEAD_COMMITTEES = ["PMT", "PMT Extended", "G3"];

const ROLE_LABELS: Record<string, string> = {
  md: "Managing Director",
  cfo: "Chief Financial Officer",
  cs: "Company Secretary",
  dgm: "Deputy General Manager",
  agm: "Assistant General Manager",
  srm: "Senior Regional Manager",
  project_officer: "Project Officer",
  associate_consultant: "Associate Consultant",
  project_assistant: "Project Assistant",
  admin: "Administrator",
};

// Decode JWT payload without verifying signature — the Supabase gateway
// already verified it before this function ran.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function generatePassword(length = 14): string {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+";
  const all = lower + upper + digits + symbols;

  function randomChar(charset: string): string {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return charset[bytes[0] % charset.length];
  }

  let pw = randomChar(lower) + randomChar(upper) + randomChar(digits) + randomChar(symbols);
  while (pw.length < length) pw += randomChar(all);

  // Shuffle so the guaranteed characters aren't always in the same
  // positions.
  const chars = pw.split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const j = bytes[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

async function sendCredentialsEmail(opts: {
  to: string;
  fullName: string;
  roleLabel: string;
  tempPassword: string;
  loginUrl: string;
}): Promise<boolean> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured");
    return false;
  }

  const safeName = escapeHtml(opts.fullName);
  const safeRole = escapeHtml(opts.roleLabel);
  const safeEmail = escapeHtml(opts.to);
  const safePassword = escapeHtml(opts.tempPassword);

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>AFC India Limited</title></head>
    <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
        <tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;max-width:600px;width:100%;">
            <tr><td style="padding:24px 32px;background:#1a5fd4;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">AFC India Limited</p>
              <p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,0.75);">Agricultural Finance Corporation · Serving India since 1968</p>
            </td></tr>
            <tr><td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear ${safeName},</p>
              <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.7;">
                A staff account has been created for you with the role of <strong>${safeRole}</strong>.
              </p>
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.08em;">Email</p>
                <p style="margin:0 0 14px;font-size:14px;color:#111827;font-family:monospace;">${safeEmail}</p>
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.08em;">Temporary Password</p>
                <p style="margin:0;font-size:18px;font-weight:700;color:#111827;font-family:monospace;letter-spacing:0.05em;">${safePassword}</p>
              </div>
              <p style="margin:0 0 8px;">
                <a href="${opts.loginUrl}" style="display:inline-block;background:#1a5fd4;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:14px;">Log in &rarr;</a>
              </p>
              <p style="margin:16px 0 0;font-size:13px;color:#374151;line-height:1.7;">
                For your security, you will be asked to set your own password the first time you sign in.
              </p>
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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "AFC India Limited <noreply@pmis.afcindia.org.in>",
      to: [opts.to],
      subject: "Your AFC India Limited staff account",
      html,
    }),
  });

  if (!res.ok) {
    console.error("Resend API error:", await res.text());
    return false;
  }
  return true;
}

// A named function (rather than inlining `createClient(...)` as the default
// parameter value) so `ReturnType<typeof ...>` resolves the same well-typed
// client as everywhere else — going through the generic `createClient`
// directly there instead makes postgrest-js's query builder fail to infer
// relation types (TS2339 SelectQueryError) even though nothing changes at
// runtime.
function createStaffAdminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function handleRequest(req: Request, adminClient: ReturnType<typeof createStaffAdminClient> = createStaffAdminClient()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: getCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, 405, { error: "Method not allowed" });

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonRes(req, 401, { error: "Unauthorized" });
  }

  const payload = decodeJwtPayload(authHeader.replace("Bearer ", "").trim());
  if (!payload?.sub || typeof payload.sub !== "string") {
    return jsonRes(req, 401, { error: "Unauthorized — invalid token payload." });
  }
  const callerUserId = payload.sub;

  try {
    // ── Caller identity — the ONLY source of truth for role/team/office ──
    const { data: caller, error: callerErr } = await adminClient
      .from("afc_users")
      .select("id, role, team, office, is_active")
      .eq("id", callerUserId)
      .single();

    if (callerErr || !caller) return jsonRes(req, 403, { error: "Caller account not found." });
    if (!caller.is_active) return jsonRes(req, 403, { error: "Your account is deactivated." });
    if (caller.role !== "admin") {
      return jsonRes(req, 403, { error: "Forbidden. Only Admin can create user accounts." });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonRes(req, 400, { error: "Invalid JSON body." });
    }

    const { email, full_name, role, committee } = body;

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return jsonRes(req, 400, { error: "Valid email is required." });
    }
    if (!full_name || typeof full_name !== "string" || full_name.trim().length < 2) {
      return jsonRes(req, 400, { error: "Full name is required." });
    }
    if (!role || typeof role !== "string") {
      return jsonRes(req, 400, { error: "Role is required." });
    }
    if (committee != null && !LEAD_COMMITTEES.includes(committee as string)) {
      return jsonRes(req, 400, { error: `Committee must be one of: ${LEAD_COMMITTEES.join(", ")}.` });
    }

    if (!ADMIN_CREATABLE_ROLES.includes(role)) {
      return jsonRes(req, 403, { error: `Admin can only create: ${ADMIN_CREATABLE_ROLES.join(", ")}.` });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: existing } = await adminClient
      .from("afc_users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (existing) return jsonRes(req, 400, { error: "An account with this email already exists." });

    const tempPassword = generatePassword();

    const { data: newAuthUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password: tempPassword,
      email_confirm: true,
    });
    if (createErr || !newAuthUser?.user) {
      return jsonRes(req, 500, {
        error: createErr?.message?.includes("already registered")
          ? "An account with this email already exists."
          : "Failed to create account. Please try again.",
      });
    }

    // `teams` (plural) is the full assignment set for team-scoped roles —
    // `team` (singular) stays the primary/home team, written to
    // afc_users.team unchanged so every existing single-team-read call site
    // keeps working. Falls back to the singular `team` field alone when
    // `teams` isn't sent, so older callers/tests still work.
    const rawTeams = Array.isArray(body.teams) ? body.teams : null;
    const teamSet = (rawTeams
      ? rawTeams.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
      : []
    );
    const finalTeam = teamSet[0] || (body.team as string) || null;
    const finalOffice = (body.office as string) || null;
    const finalCommittee = (committee as string) || null;
    // Every account starts with the same default action PIN ("1234") so a
    // new user can act on PIN-gated lead actions immediately — same idea as
    // the generated temp password, changeable any time from My Profile.
    const defaultPinHash = await hashPin(DEFAULT_PIN, newAuthUser.user.id);

    const { error: insertErr } = await adminClient.from("afc_users").insert([
      {
        id: newAuthUser.user.id,
        full_name: full_name.trim(),
        email: normalizedEmail,
        role,
        team: finalTeam,
        office: finalOffice,
        committee: finalCommittee,
        is_active: true,
        must_change_password: true,
        created_by: caller.id,
        managed_by_dgm: null,
        pin_hash: defaultPinHash,
        pin_updated_at: new Date().toISOString(),
      },
    ]);

    if (insertErr) {
      // Roll back the orphaned Auth account — a user with no profile row
      // can never pass ProtectedRoute's profile check anyway.
      await adminClient.auth.admin.deleteUser(newAuthUser.user.id);
      return jsonRes(req, 500, { error: "Failed to save user profile. Please try again." });
    }

    const teamsToAssign = teamSet.length ? teamSet : (finalTeam ? [finalTeam] : []);
    if (teamsToAssign.length) {
      const { error: teamsErr } = await adminClient
        .from("afc_user_teams")
        .insert(teamsToAssign.map((team) => ({ user_id: newAuthUser.user.id, team })));
      if (teamsErr) console.error("Failed to insert afc_user_teams:", teamsErr.message);
    }

    // ── Notify the new user (best-effort — never fails account creation) ──
    try {
      await adminClient.from("notifications").insert({
        user_id: newAuthUser.user.id,
        title: "Welcome to AFC India Limited",
        sub_text: `Your ${ROLE_LABELS[role] || role} account has been created. Sign in and set a new password to get started.`,
        type: "account_created",
        link: "/change-password",
      });
    } catch (notifErr) {
      console.error("Failed to insert welcome notification:", (notifErr as Error).message);
    }

    const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";
    const emailSent = await sendCredentialsEmail({
      to: normalizedEmail,
      fullName: full_name.trim(),
      roleLabel: ROLE_LABELS[role] || role,
      tempPassword,
      loginUrl: `${siteUrl}/login`,
    });

    await adminClient.from("application_audit_log").insert({
      action_by: caller.id,
      action_by_role: caller.role,
      action: emailSent ? "user_created" : "user_created_email_failed",
      comment: `Created ${role} account for ${normalizedEmail} in team ${finalTeam || "none"}`,
    });

    // Only ever return the plaintext password when email delivery failed —
    // it is never logged and never returned otherwise.
    return jsonRes(
      req,
      200,
      emailSent
        ? { success: true, email_sent: true, id: newAuthUser.user.id }
        : { success: true, email_sent: false, password: tempPassword, id: newAuthUser.user.id }
    );
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    return jsonRes(req, 500, { error: "Internal server error." });
  }
}

// AFC_EDGE_TEST is never set in any real deployment — only by the test
// command (see supabase/functions/deno.json). Wrapped rather than passed
// directly: `serve` invokes its handler with a second `connInfo` argument,
// which would otherwise land in `adminClient`'s slot.
if (Deno.env.get("AFC_EDGE_TEST") !== "1") {
  serve((req) => handleRequest(req));
}
