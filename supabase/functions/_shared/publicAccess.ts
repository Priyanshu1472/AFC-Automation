// supabase/functions/_shared/publicAccess.ts
// Shared anon-key check + IP rate limiter for public (verify_jwt = false)
// edge functions — submit-ba-form, submit-empanelment-correction,
// get-empanelment-correction-info. These are the only server-side gate on
// a 5-digit application_code (100,000 combinations), so the rate limit is
// load-bearing, not cosmetic — it's backed by the check_rate_limit() DB
// function (see 20260720160000_db_rate_limit.sql), not an in-memory Map.
// Edge functions are distributed/ephemeral instances; an in-memory counter
// isn't actually shared across them and resets on every cold start, which
// lets an attacker spreading requests across source IPs (or just waiting
// out a cold start) brute-force the code with no real limit at all.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

export function checkAnonKey(req: Request): boolean {
  const apiKey = req.headers.get("apikey");
  const authHeader = req.headers.get("authorization");
  const providedKey = apiKey || authHeader?.replace("Bearer ", "");
  if (!providedKey) return false;
  // Newer Supabase projects (e.g. prod, ydymhqzvnrxdjfehmawv) inject the new
  // sb_publishable_… key as SUPABASE_ANON_KEY, while the frontend still
  // sends the legacy JWT anon key — so the legacy key is also accepted via
  // the LEGACY_ANON_KEY secret (set on prod; unset on older projects where
  // SUPABASE_ANON_KEY already is the legacy key).
  const accepted = [Deno.env.get("SUPABASE_ANON_KEY"), Deno.env.get("LEGACY_ANON_KEY")].filter(Boolean);
  return accepted.includes(providedKey);
}

export function getClientIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// `key` should namespace by function + IP (e.g. `correction:${ip}`) so the
// same IP hitting two different public endpoints doesn't share one budget.
export async function checkRateLimit(
  adminClient: SupabaseClient,
  key: string,
  max = 5,
  windowSeconds = 15 * 60
): Promise<{ allowed: boolean; waitMinutes: number }> {
  const { data, error } = await adminClient.rpc("check_rate_limit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) {
    // Fail closed would take down the public form on any DB hiccup; fail
    // open here since the anon-key check and the app_code match still
    // apply — this is defense-in-depth, not the only gate.
    console.error("check_rate_limit failed:", error.message);
    return { allowed: true, waitMinutes: 0 };
  }
  const row = data?.[0];
  return { allowed: row?.allowed ?? true, waitMinutes: Math.ceil((row?.wait_seconds ?? 0) / 60) };
}

// Resets a key's budget after a legitimate success, so a real BP isn't
// stuck rate-limited by their own earlier typos/retries.
export async function clearRateLimit(adminClient: SupabaseClient, key: string) {
  const { error } = await adminClient.from("rate_limit_attempts").delete().eq("key", key);
  if (error) console.error("clearRateLimit failed:", error.message);
}
