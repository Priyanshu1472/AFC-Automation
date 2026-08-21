// supabase/functions/_shared/auth.ts
// Shared caller-authentication helper for JWT-verified edge functions.
// (Public functions like submit-ba-form use an anon-key + rate-limit check
// instead — see _shared/publicAccess.ts.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

export function createAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, supabaseService, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Decode JWT payload without verifying signature — the Supabase gateway
// already verified it before this function ran (verify_jwt = true).
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

export type CallerProfile = {
  id: string;
  role: string;
  team: string | null;
  office: string | null;
  committee: string | null;
  is_active: boolean;
  email: string;
  pin_hash: string | null;
};

export type CallerResult =
  | { ok: true; caller: CallerProfile }
  | { ok: false; status: number; error: string };

// Authenticate the caller from the Authorization header and look up their
// afc_users row — the ONLY source of truth for role/team/office, never
// trust a role/team sent in the request body.
export async function getCallerProfile(
  req: Request,
  adminClient: ReturnType<typeof createAdminClient>
): Promise<CallerResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const payload = decodeJwtPayload(authHeader.replace("Bearer ", "").trim());
  if (!payload?.sub || typeof payload.sub !== "string") {
    return { ok: false, status: 401, error: "Unauthorized — invalid token payload." };
  }

  const { data: caller, error } = await adminClient
    .from("afc_users")
    .select("id, role, team, office, committee, is_active, email, pin_hash")
    .eq("id", payload.sub)
    .single();

  if (error || !caller) return { ok: false, status: 403, error: "Caller account not found." };
  if (!caller.is_active) return { ok: false, status: 403, error: "Your account is deactivated." };

  return { ok: true, caller };
}
