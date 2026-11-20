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
  // Effective role for permission checks — "admin" for a Super Admin.
  role: string;
  // The afc_users.role as stored ("super_admin" for a Super Admin).
  actual_role?: string;
  team: string | null;
  office: string | null;
  committee: string | null;
  is_active: boolean;
  email: string;
  pin_hash: string | null;
  // Full assigned-team membership (primary `team` included) — a
  // multi-team user (e.g. a DGM covering 2 teams) is authorized against
  // this whole set, not just the primary team, for both read (RLS mirrors
  // this via is_current_user_team()) and write-side checks below.
  teams: string[];
  // Full assigned-committee membership (primary `committee` included) —
  // a user can now hold more than one (e.g. PMT and Accounts), so every
  // "is this caller on committee X" check should use this, not
  // `caller.committee === "X"` — that only ever sees the primary one.
  committees: string[];
};

// Is the caller a member of `team` at all — every write-side "only this
// team's DGM/PO/etc. can act" check should use this instead of
// `caller.team === target.team`, so a multi-team user isn't limited to
// acting only on their primary team.
export function isCallerOnTeam(caller: Pick<CallerProfile, "teams">, team: string | null | undefined): boolean {
  return !!team && caller.teams.includes(team);
}

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

  const { data: teamRows } = await adminClient.from("afc_user_teams").select("team").eq("user_id", caller.id);
  const teamSet = (teamRows || []).map((r: { team: string }) => r.team);
  const teams = teamSet.length ? teamSet : (caller.team ? [caller.team] : []);

  const { data: committeeRows } = await adminClient.from("afc_user_committees").select("committee").eq("user_id", caller.id);
  const committeeSet = (committeeRows || []).map((r: { committee: string }) => r.committee);
  const committees = committeeSet.length ? committeeSet : (caller.committee ? [caller.committee] : []);

  // Super Admin has every Admin power (plus Module Settings), so every
  // `caller.role === "admin"` / `["md","admin"].includes(caller.role)`
  // check here treats them as Admin — same mapping as the DB's
  // current_afc_role() (20261120000000_super_admin_has_admin_powers.sql).
  // `actual_role` keeps the real value for anything that must tell them apart.
  const actual_role = caller.role;
  const role = caller.role === "super_admin" ? "admin" : caller.role;

  return { ok: true, caller: { ...caller, role, actual_role, teams, committees } };
}
